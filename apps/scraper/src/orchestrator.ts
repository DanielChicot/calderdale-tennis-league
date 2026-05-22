import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import {
  parseClubsDirectory,
  parseFixturesAndResults,
  parseMatchCard,
  parseClubContacts,
  parseClubLocation,
  parseLeagueTable,
  parsePlayerRankings,
} from '@ctl/parser';
import { createScrapeHttpClient, type ScrapeHttpClient } from './http-client.js';
import { detectAndPersistSeasons } from './season-detector.js';
import { resolveClub } from './entity-resolver.js';
import {
  buildInitialSteps,
  buildDivisionSteps,
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
    const [prior] = await db.select().from(schema.scrapeRuns).where(eq(schema.scrapeRuns.url, step.url));
    const priorFetch = prior
      ? {
          ...(prior.lastModified != null ? { lastModified: prior.lastModified } : {}),
          ...(prior.contentHash != null ? { contentHash: prior.contentHash } : {}),
        }
      : undefined;
    const result = await http.fetchPage(step.url, priorFetch);

    if (result.kind === 'unchanged') {
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: step.url,
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
          url: step.url,
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
      console.error(`[orchestrator] parse failed for ${step.url}:`, err);
      await db
        .insert(schema.scrapeRuns)
        .values({
          url: step.url,
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
      case 'fixtures-and-results': {
        parseFixturesAndResults(html);
        // Resolve teams via club aliases (team name is also the club's team name in this league)
        // For Phase 2 minimum: upsert fixture, skip team FK resolution if teams not yet seeded.
        // Teams are created when the league table is parsed (not yet implemented in this minimum).
        // This is a known gap — see follow-up Phase 2 task on league-table → teams seeding.
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
      case 'league-table': {
        parseLeagueTable(html);
        // Upsert team rows into the current division; populate canonical names via aliases.
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

    // 3. Division-level steps for the current season
    const divisions = await db
      .select({
        divisionId: schema.divisions.id,
        divisionSlug: schema.divisions.slug,
      })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, detection.currentSeasonId));

    // Phase 2 minimum: upstream modeID-per-division is read from a static seed file
    // OR discovered by parsing the home page season nav. For now, the orchestrator
    // assumes a `division.upstream_mode_id` column will be added in a follow-up — and
    // skips division-level steps if no mapping is available. This is a known
    // limitation, called out in the spec.
    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: 0,        // placeholder — populated when known
    }));
    const divisionSteps = buildDivisionSteps('Summer 2026', descriptors);
    for (const step of divisionSteps) {
      if (step.kind === 'fixtures-and-results' && step.modeId === 0) continue;
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
    const divisions = await db
      .select({ divisionId: schema.divisions.id, divisionSlug: schema.divisions.slug })
      .from(schema.divisions)
      .where(eq(schema.divisions.seasonId, season.id));
    const descriptors: DivisionDescriptor[] = divisions.map((d) => ({
      divisionId: d.divisionId,
      divisionSlug: d.divisionSlug,
      upstreamModeId: 0,
    }));
    for (const step of buildDivisionSteps(season.name, descriptors)) {
      if (step.kind === 'fixtures-and-results' && step.modeId === 0) continue;
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
