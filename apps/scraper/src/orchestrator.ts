import { aliasedTable, and, eq, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import {
  parseClubsDirectory,
  parseDivisionsDropdown,
  parseFixturesAndResults,
  parseMatchCard,
  parseClubContacts,
  parseClubLocation,
  parseLeagueTableWithTeamIds,
  parsePlayerRankings,
} from '@ctl/parser';
import { createScrapeHttpClient, type ScrapeHttpClient } from './http-client.js';
import { detectAndPersistSeasons } from './season-detector.js';
import { resolveClub, resolvePlayer, resolveTeam, resolveDivisionName } from './entity-resolver.js';
import {
  buildInitialSteps,
  buildDivisionSteps,
  buildDivisionsDiscoveryStep,
  buildMatchCardStep,
  buildPlayerRankingsStep,
  type WalkStep,
  type DivisionDescriptor,
} from './walk-plan.js';

export type Orchestrator = {
  runCurrent: () => Promise<OrchestratorReport>;
  runSeason: (seasonSlug: string) => Promise<OrchestratorReport>;
  runBackfill: () => Promise<OrchestratorReport[]>;
};

export type OrchestratorReport = {
  stepsExecuted: number;
  stepsSkipped: number;
  parseFailures: number;
  currentSeasonId: number;
};

export const createOrchestrator = (db: Database, http: ScrapeHttpClient = createScrapeHttpClient()): Orchestrator => {
  const runStep = async (
    step: WalkStep,
    opts: { ignorePrior?: boolean } = {},
  ): Promise<'executed' | 'skipped' | 'failed'> => {
    const runKey = 'postBody' in step
      ? `${step.url}#bh:${createHash('sha256').update(step.postBody).digest('hex').slice(0, 8)}`
      : step.url;
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, runKey));
    // Only dedup against the prior fetch when its parse SUCCEEDED. A failed parse must
    // re-run the handler even if the page content is unchanged — otherwise the content
    // hash returns 'unchanged' on every retry and the failure can never self-heal.
    // Callers can also opt out entirely (ignorePrior) when they know the DB state is
    // missing regardless of page content — e.g. the missing-cards stage re-ingesting
    // after a truncate: the page is unchanged but the rows must be rewritten.
    const priorFetch = prior && prior.lastParseOk && !opts.ignorePrior
      ? {
          ...(prior.lastModified != null ? { lastModified: prior.lastModified } : {}),
          ...(prior.contentHash != null ? { contentHash: prior.contentHash } : {}),
        }
      : undefined;
    const result = 'postBody' in step
      ? await http.fetchPagePost(step.url, step.postBody, priorFetch)
      : await http.fetchPage(step.url, priorFetch);

    if (result.kind === 'unchanged') {
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: runKey,
          lastFetchedAt: new Date(),
          lastStatus: result.status,
          lastParseOk: true,
          contentHash: result.contentHash ?? prior?.contentHash ?? null,
          lastModified: prior?.lastModified ?? null,
        })
        .onConflictDoUpdate({
          target: schema.scrapeRuns.url,
          set: { lastFetchedAt: new Date(), lastStatus: result.status },
        });
      return 'skipped';
    }

    try {
      await handleStep(step, result.html);
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: runKey,
          lastFetchedAt: new Date(),
          lastStatus: result.status,
          lastParseOk: true,
          contentHash: result.contentHash,
          lastModified: result.lastModified ?? null,
        })
        .onConflictDoUpdate({
          target: schema.scrapeRuns.url,
          set: {
            lastFetchedAt: new Date(),
            lastStatus: result.status,
            lastParseOk: true,
            contentHash: result.contentHash,
            lastModified: result.lastModified ?? null,
            lastError: null,
          },
        });
      return 'executed';
    } catch (err) {
      console.error(`[orchestrator] parse failed for ${runKey}:`, err);
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: runKey,
          lastFetchedAt: new Date(),
          lastStatus: result.status,
          lastParseOk: false,
          contentHash: result.contentHash,
          lastError: String(err),
        })
        .onConflictDoUpdate({
          target: schema.scrapeRuns.url,
          set: { lastFetchedAt: new Date(), lastParseOk: false, lastError: String(err) },
        });
      return 'failed';
    }
  };

  const handleStep = async (step: WalkStep, html: string): Promise<void> => {
    switch (step.kind) {
      case 'season-nav':
        // handled separately at run start
        return;
      case 'clubs-directory': {
        const rows = parseClubsDirectory(html);
        for (const row of rows) {
          await resolveClub(db, row.observedName);
        }
        return;
      }
      case 'divisions-discovery': {
        // The seasonId is read directly off the step (set by the caller), so this
        // handler is now safe to schedule for any season — not just the current one.
        const rows = parseDivisionsDropdown(html);
        for (const row of rows) {
          await db
            .insert(schema.divisions)
            .values({
              slug: row.slug,
              name: row.observedName,
              group: row.group,
              seasonId: step.seasonId,
              upstreamModeId: row.modeId,
            })
            .onConflictDoUpdate({
              // Use (upstream_mode_id, season_id) as the stable identity — upstream's
              // modeID rarely changes, but the displayed name (and therefore slug) can.
              // This prevents orphan rows when upstream renames a division.
              // Edge case: if upstream renames division A to a slug that collides with
              // an existing different division B in the same season, the slug update
              // will hit divisions_slug_season_idx and throw. runStep catches and logs
              // it as a parseFailure — acceptable recovery, very unlikely in practice.
              target: [schema.divisions.upstreamModeId, schema.divisions.seasonId],
              set: {
                slug: row.slug,
                name: row.observedName,
                group: row.group,
              },
            });
        }
        return;
      }
      case 'fixtures-and-results': {
        const rows = parseFixturesAndResults(html);
        let skipped = 0;
        for (const row of rows) {
          if (!row.fixtureRef) {
            skipped++;
            continue;
          }
          // Team resolution runs OUTSIDE the per-fixture transaction. resolveTeam has
          // its own transaction internally and is idempotent — wrapping it again here
          // would either nest transactions (drizzle/postgres-js doesn't support that
          // cleanly) or block. The fixture+results pair IS atomic via this tx.
          const homeTeamId = await resolveTeam(db, row.homeTeamName, step.divisionId);
          const awayTeamId = await resolveTeam(db, row.awayTeamName, step.divisionId);
          await db.transaction(async (tx) => {
            const [fixture] = await tx
              .insert(schema.fixtures)
              .values({
                upstreamId: row.fixtureRef!.id,
                upstreamCardId: row.fixtureRef!.cardId,
                date: row.date,
                homeTeamId,
                awayTeamId,
                divisionId: step.divisionId,
                status: row.status,
              })
              .onConflictDoUpdate({
                target: schema.fixtures.upstreamId,
                set: {
                  date: row.date,
                  status: row.status,
                  homeTeamId,
                  awayTeamId,
                  divisionId: step.divisionId,
                  upstreamCardId: row.fixtureRef!.cardId,
                },
              })
              .returning();
            if (row.score) {
              await tx
                .insert(schema.results)
                .values({
                  fixtureId: fixture!.id,
                  homeScore: String(row.score.home),
                  awayScore: String(row.score.away),
                })
                .onConflictDoUpdate({
                  target: schema.results.fixtureId,
                  set: { homeScore: String(row.score.home), awayScore: String(row.score.away) },
                });
            }
          });
        }
        if (skipped > 0) {
          console.warn(`[orchestrator] fixtures-and-results: skipped ${skipped} row(s) without fixtureRef (division ${step.divisionId})`);
        }
        return;
      }
      case 'match-card': {
        const { rubbers: parsedRubbers } = parseMatchCard(html);

        // Both sides' clubs in one query — players resolve against their team's club.
        const homeTeam = aliasedTable(schema.teams, 'home_team');
        const awayTeam = aliasedTable(schema.teams, 'away_team');
        const [fx] = await db
          .select({ homeClubId: homeTeam.clubId, awayClubId: awayTeam.clubId })
          .from(schema.fixtures)
          .innerJoin(homeTeam, eq(homeTeam.id, schema.fixtures.homeTeamId))
          .innerJoin(awayTeam, eq(awayTeam.id, schema.fixtures.awayTeamId))
          .where(eq(schema.fixtures.id, step.fixtureId));
        if (!fx) throw new Error(`match-card: fixture ${step.fixtureId} not found`);

        // Resolve players OUTSIDE the tx — resolvePlayer has its own internal
        // transaction and is idempotent (same pattern as resolveTeam).
        const resolvedRubbers: Array<{
          orderInCard: number;
          homeIds: number[];
          awayIds: number[];
          sets: { home: number; away: number }[];
        }> = [];
        for (const r of parsedRubbers) {
          const homeIds: number[] = [];
          for (const name of r.homePlayerNames) homeIds.push(await resolvePlayer(db, name, fx.homeClubId));
          const awayIds: number[] = [];
          for (const name of r.awayPlayerNames) awayIds.push(await resolvePlayer(db, name, fx.awayClubId));
          resolvedRubbers.push({ orderInCard: r.orderInCard, homeIds, awayIds, sets: r.sets });
        }

        // Atomic unit: card + children. An EMPTY card still gets a match_cards row —
        // "fetched, nothing there" — so the missing-cards query doesn't refetch forever.
        await db.transaction(async (tx) => {
          const [card] = await tx
            .insert(schema.matchCards)
            .values({ fixtureId: step.fixtureId })
            .onConflictDoUpdate({
              target: schema.matchCards.fixtureId,
              set: { fixtureId: step.fixtureId },   // no-op set to make .returning() work on conflict
            })
            .returning();
          // Delete-and-reinsert children (cascades rubbers → set_scores). Cards are
          // tiny (≤9 rubbers × ≤3 sets); diffing isn't worth the complexity.
          await tx.delete(schema.rubbers).where(eq(schema.rubbers.matchCardId, card!.id));
          for (const r of resolvedRubbers) {
            const [rubber] = await tx
              .insert(schema.rubbers)
              .values({
                matchCardId: card!.id,
                orderInCard: r.orderInCard,
                homePlayerIds: r.homeIds,
                awayPlayerIds: r.awayIds,
              })
              .returning();
            for (const [i, s] of r.sets.entries()) {
              await tx.insert(schema.setScores).values({
                rubberId: rubber!.id,
                orderInRubber: i + 1,
                homeScore: s.home,
                awayScore: s.away,
              });
            }
          }
        });
        return;
      }
      case 'club-contacts': {
        parseClubContacts(html);
        // Phase 2 minimum: contacts stored alongside teams; deferred to follow-up.
        return;
      }
      case 'club-location': {
        parseClubLocation(html);
        // Phase 2 minimum: location columns on clubs table; deferred to follow-up.
        return;
      }
      case 'league-table-post': {
        const parsed = parseLeagueTableWithTeamIds(html);
        const idByName = new Map(parsed.teamHandlers.map((h) => [h.teamName, h.upstreamTeamId]));
        const handlerNamesMatchedByStandings = new Set<string>();

        for (const row of parsed.standings) {
          const teamId = await resolveTeam(db, row.teamName, step.divisionId);
          const upstreamId = idByName.get(row.teamName);
          if (upstreamId !== undefined) {
            handlerNamesMatchedByStandings.add(row.teamName);
            const [existing] = await db
              .select({ upstreamTeamId: schema.teams.upstreamTeamId })
              .from(schema.teams)
              .where(eq(schema.teams.id, teamId))
              .limit(1);
            if (existing?.upstreamTeamId == null) {
              await db
                .update(schema.teams)
                .set({ upstreamTeamId: upstreamId })
                .where(eq(schema.teams.id, teamId));
            } else if (existing.upstreamTeamId !== upstreamId) {
              console.warn(
                `[orchestrator] upstream_team_id mismatch for team ${teamId} (${row.teamName}): existing=${existing.upstreamTeamId}, observed=${upstreamId}; keeping existing`,
              );
            }
          } else {
            console.warn(
              `[orchestrator] standings row "${row.teamName}" has no matching contacts handler in division ${step.divisionId}`,
            );
          }

          await db
            .insert(schema.standings)
            .values({
              teamId,
              divisionId: step.divisionId,
              position: row.position,
              resultsReceived: row.resultsReceived,
              resultsTotal: row.resultsTotal,
              pointsWon: String(row.pointsWon),
              pointsLost: String(row.pointsLost),
            })
            .onConflictDoUpdate({
              target: schema.standings.teamId,
              set: {
                divisionId: step.divisionId,
                position: row.position,
                resultsReceived: row.resultsReceived,
                resultsTotal: row.resultsTotal,
                pointsWon: String(row.pointsWon),
                pointsLost: String(row.pointsLost),
              },
            });
        }

        for (const h of parsed.teamHandlers) {
          if (!handlerNamesMatchedByStandings.has(h.teamName)) {
            console.warn(
              `[orchestrator] contacts handler "${h.teamName}" (upstreamId=${h.upstreamTeamId}) has no matching standings row in division ${step.divisionId}`,
            );
          }
        }
        return;
      }
      case 'player-rankings-post': {
        const rows = parsePlayerRankings(html);

        // Pre-fetch all divisions in this group/season so the per-row lookup is O(1).
        const divisionsInGroup = await db
          .select({ id: schema.divisions.id, name: schema.divisions.name })
          .from(schema.divisions)
          .where(
            and(eq(schema.divisions.group, step.group), eq(schema.divisions.seasonId, step.seasonId)),
          );
        const divisionByName = new Map(divisionsInGroup.map((d) => [d.name, d.id]));

        let skippedNoDivision = 0;
        let skippedNoClub = 0;

        for (const row of rows) {
          const fullName = resolveDivisionName(step.group, row.primaryDivision);
          if (!fullName) {
            skippedNoDivision++;
            continue;
          }
          const divisionId = divisionByName.get(fullName);
          if (divisionId === undefined) {
            skippedNoDivision++;
            continue;
          }

          if (!row.clubName) {
            skippedNoClub++;
            continue;
          }
          const clubId = await resolveClub(db, row.clubName);
          const playerId = await resolvePlayer(db, row.playerName, clubId);

          await db
            .insert(schema.rankings)
            .values({
              playerId,
              divisionId,
              rank: row.rank,
              rubbersWon: String(row.rubbersWon),
              rubbersPlayed: String(row.rubbersPlayed),
              gamesWon: row.gamesWon,
              gamesPlayed: row.gamesPlayed,
              rankingScore: String(row.rankingScore),
              movement: row.movement,
            })
            .onConflictDoUpdate({
              target: [schema.rankings.playerId, schema.rankings.divisionId],
              set: {
                rank: row.rank,
                rubbersWon: String(row.rubbersWon),
                rubbersPlayed: String(row.rubbersPlayed),
                gamesWon: row.gamesWon,
                gamesPlayed: row.gamesPlayed,
                rankingScore: String(row.rankingScore),
                movement: row.movement,
              },
            });
        }

        if (skippedNoDivision > 0) {
          console.warn(
            `[orchestrator] player-rankings-post: skipped ${skippedNoDivision} row(s) with unmappable primaryDivision (group=${step.group})`,
          );
        }
        if (skippedNoClub > 0) {
          console.warn(
            `[orchestrator] player-rankings-post: skipped ${skippedNoClub} row(s) with null clubName (group=${step.group})`,
          );
        }
        return;
      }
      case 'locations-directory':
        return;
    }
  };

  const runCurrent = async (): Promise<OrchestratorReport> => {
    const report: OrchestratorReport = { stepsExecuted: 0, stepsSkipped: 0, parseFailures: 0, currentSeasonId: 0 };

    // 1. season nav — first, since other walk steps depend on the current season
    const homeStep = buildInitialSteps()[0]!;
    const [priorHome] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, homeStep.url));
    const priorHomeFetch = priorHome
      ? {
          ...(priorHome.lastModified != null ? { lastModified: priorHome.lastModified } : {}),
          ...(priorHome.contentHash != null ? { contentHash: priorHome.contentHash } : {}),
        }
      : undefined;
    const homeResult = await http.fetchPage(homeStep.url, priorHomeFetch);
    let homeHtml: string;
    if (homeResult.kind === 'changed') {
      homeHtml = homeResult.html;
    } else {
      // If unchanged, refetch without prior to force a body — needed for season-nav parsing.
      const refetch = await http.fetchPage(homeStep.url);
      if (refetch.kind !== 'changed') throw new Error('orchestrator: cannot acquire home page HTML');
      homeHtml = refetch.html;
    }
    const detection = await detectAndPersistSeasons(db, homeHtml);
    report.currentSeasonId = detection.currentSeasonId;

    // 2. clubs directory
    const clubsStep = buildInitialSteps()[1]!;
    const r = await runStep(clubsStep);
    r === 'executed' ? report.stepsExecuted++ : r === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;

    // 2b. discover divisions from the league-table page
    const discStep = buildDivisionsDiscoveryStep(detection.currentSeasonName, detection.currentSeasonId);
    const dr = await runStep(discStep);
    dr === 'executed' ? report.stepsExecuted++ : dr === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;

    // 3. Division-level steps for the current season
    const divisions = await db
      .select({
        divisionId: schema.divisions.id,
        divisionSlug: schema.divisions.slug,
        upstreamModeId: schema.divisions.upstreamModeId,
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, detection.currentSeasonId));

    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: d.upstreamModeId,
    }));
    const divisionSteps = buildDivisionSteps(detection.currentSeasonName, descriptors);
    for (const step of divisionSteps) {
      const outcome = await runStep(step);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    // 4. Per-group player rankings — one POST per division group. Each response
    // carries the whole group's leaderboard, so 3 fetches cover all 9 divisions.
    const groupReps = await db
      .select({
        group: schema.divisions.group,
        sampleModeId: sql<number>`MIN(${schema.divisions.upstreamModeId})`.as('sample_mode_id'),
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, detection.currentSeasonId))
      .groupBy(schema.divisions.group);

    for (const g of groupReps) {
      const rankStep = buildPlayerRankingsStep(
        detection.currentSeasonName,
        detection.currentSeasonId,
        g.group,
        Number(g.sampleModeId),
      );
      const outcome = await runStep(rankStep);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    // 5. Match cards — fetch only played fixtures that don't have a card yet.
    // Failed fetches/parses self-heal: no match_cards row lands, so the fixture
    // reappears in this query next run (and the runStep retry guard ensures the
    // handler actually re-runs even when page content is unchanged).
    const missingCards = await db
      .select({
        fixtureId: schema.fixtures.id,
        upstreamId: schema.fixtures.upstreamId,
        upstreamCardId: schema.fixtures.upstreamCardId,
      })
      .from(schema.fixtures)
      .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
      .where(
        and(
          eq(schema.divisions.seasonId, detection.currentSeasonId),
          inArray(schema.fixtures.status, ['completed', 'rubbers-conceded']),
          isNotNull(schema.fixtures.upstreamCardId),
          notExists(
            db
              .select()
              .from(schema.matchCards)
              .where(eq(schema.matchCards.fixtureId, schema.fixtures.id)),
          ),
        ),
      );

    for (const f of missingCards) {
      const cardStep = buildMatchCardStep(f.fixtureId, f.upstreamCardId!, f.upstreamId!);
      const outcome = await runStep(cardStep, { ignorePrior: true });
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    return report;
  };

  const runSeason = async (seasonSlug: string): Promise<OrchestratorReport> => {
    // Fetch home, detect + persist seasons
    const homeStep = buildInitialSteps()[0]!;
    const homeResult = await http.fetchPage(homeStep.url);
    if (homeResult.kind !== 'changed') throw new Error('runSeason: cannot acquire home page');
    await detectAndPersistSeasons(db, homeResult.html);

    // Look up named season
    const [season] = await db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.slug, seasonSlug))
      .limit(1);
    if (!season) throw new Error(`runSeason: unknown season slug ${seasonSlug}`);

    // Walk division steps for that season
    const report: OrchestratorReport = {
      stepsExecuted: 0,
      stepsSkipped: 0,
      parseFailures: 0,
      currentSeasonId: season.id,
    };
    // Schedule divisions-discovery for this season too — the handler now reads
    // seasonId off the step, so it's safe to call for any season. This populates
    // divisions for archive seasons on --season=<slug> backfill walks.
    const discStep = buildDivisionsDiscoveryStep(season.name, season.id);
    const dr = await runStep(discStep);
    dr === 'executed' ? report.stepsExecuted++ : dr === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;

    const divisions = await db
      .select({
        divisionId: schema.divisions.id,
        divisionSlug: schema.divisions.slug,
        upstreamModeId: schema.divisions.upstreamModeId,
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, season.id));
    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: d.upstreamModeId,
    }));
    for (const step of buildDivisionSteps(season.name, descriptors)) {
      const outcome = await runStep(step);
      outcome === 'executed'
        ? report.stepsExecuted++
        : outcome === 'skipped'
          ? report.stepsSkipped++
          : report.parseFailures++;
    }

    // Per-group player rankings — same stage as runCurrent, keyed to this season.
    const groupReps = await db
      .select({
        group: schema.divisions.group,
        sampleModeId: sql<number>`MIN(${schema.divisions.upstreamModeId})`.as('sample_mode_id'),
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, season.id))
      .groupBy(schema.divisions.group);

    for (const g of groupReps) {
      const rankStep = buildPlayerRankingsStep(season.name, season.id, g.group, Number(g.sampleModeId));
      const outcome = await runStep(rankStep);
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }

    // Match cards — same stage as runCurrent, keyed to this season.
    const missingCards = await db
      .select({
        fixtureId: schema.fixtures.id,
        upstreamId: schema.fixtures.upstreamId,
        upstreamCardId: schema.fixtures.upstreamCardId,
      })
      .from(schema.fixtures)
      .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
      .where(
        and(
          eq(schema.divisions.seasonId, season.id),
          inArray(schema.fixtures.status, ['completed', 'rubbers-conceded']),
          isNotNull(schema.fixtures.upstreamCardId),
          notExists(
            db
              .select()
              .from(schema.matchCards)
              .where(eq(schema.matchCards.fixtureId, schema.fixtures.id)),
          ),
        ),
      );

    for (const f of missingCards) {
      const cardStep = buildMatchCardStep(f.fixtureId, f.upstreamCardId!, f.upstreamId!);
      const outcome = await runStep(cardStep, { ignorePrior: true });
      outcome === 'executed' ? report.stepsExecuted++ : outcome === 'skipped' ? report.stepsSkipped++ : report.parseFailures++;
    }
    return report;
  };

  const runBackfill = async (): Promise<OrchestratorReport[]> => {
    // Fetch home, persist seasons
    const homeStep = buildInitialSteps()[0]!;
    const homeResult = await http.fetchPage(homeStep.url);
    if (homeResult.kind !== 'changed') throw new Error('runBackfill: cannot acquire home page');
    await detectAndPersistSeasons(db, homeResult.html);

    // Then run runSeason for every season in the DB
    const allSeasons = await db.select({ slug: schema.seasons.slug }).from(schema.seasons);
    const reports: OrchestratorReport[] = [];
    for (const s of allSeasons) {
      const report = await runSeason(s.slug);
      reports.push(report);
    }
    return reports;
  };

  return { runCurrent, runSeason, runBackfill };
};
