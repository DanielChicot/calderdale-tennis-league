import { eq } from 'drizzle-orm';
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
import { resolveClub, resolveTeam } from './entity-resolver.js';
import {
  buildInitialSteps,
  buildDivisionSteps,
  buildDivisionsDiscoveryStep,
  buildMatchCardStep,
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
  const runStep = async (step: WalkStep): Promise<'executed' | 'skipped' | 'failed'> => {
    const runKey = 'postBody' in step
      ? `${step.url}#bh:${createHash('sha256').update(step.postBody).digest('hex').slice(0, 8)}`
      : step.url;
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, runKey));
    const priorFetch = prior
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
        // INVARIANT: only scheduled from runCurrent, after detectAndPersistSeasons has
        // set current=true for the desired season. Do NOT schedule from runSeason
        // or runBackfill — the handler keys off seasons.current=true and would
        // overwrite divisions for the wrong season.
        const rows = parseDivisionsDropdown(html);
        // Pin to the current season — division uniqueness is (slug, season_id) and
        // (upstream_mode_id, season_id), so a re-run for the same season is idempotent.
        const [currentSeason] = await db
          .select({ id: schema.seasons.id })
          .from(schema.seasons)
          .where(eq(schema.seasons.current, true))
          .limit(1);
        if (!currentSeason) throw new Error('divisions-discovery: no current season set');
        for (const row of rows) {
          await db
            .insert(schema.divisions)
            .values({
              slug: row.slug,
              name: row.observedName,
              group: row.group,
              seasonId: currentSeason.id,
              upstreamModeId: row.modeId,
            })
            .onConflictDoUpdate({
              target: [schema.divisions.slug, schema.divisions.seasonId],
              set: { name: row.observedName, upstreamModeId: row.modeId, group: row.group },
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
                date: row.date,
                homeTeamId,
                awayTeamId,
                divisionId: step.divisionId,
                status: row.status,
              })
              .onConflictDoUpdate({
                target: schema.fixtures.upstreamId,
                set: { date: row.date, status: row.status, homeTeamId, awayTeamId, divisionId: step.divisionId },
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
        parseMatchCard(html);
        // Upsert match_cards, rubbers, set_scores under the fixtureId
        // (Implementation depends on player resolution which depends on team resolution.)
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
      case 'player-rankings': {
        parsePlayerRankings(html);
        // Resolve player and division; upsert ranking row.
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
    const discStep = buildDivisionsDiscoveryStep(detection.currentSeasonName);
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
    // NOTE: divisions-discovery is intentionally omitted here — runSeason consumes
    // divisions already persisted by a prior runCurrent. Adding it would risk
    // writing rows for the wrong season (see invariant in handleStep above).
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
