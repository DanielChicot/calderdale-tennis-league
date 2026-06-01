import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { schema } from '@ctl/db';

const fixtureHtml = (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('orchestrator modes', () => {
  beforeAll(async () => {
    await startDb();
  }, 120_000);
  afterAll(async () => {
    await stopDb();
  });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores, rankings, scrape_runs RESTART IDENTITY CASCADE`,
    );
  });

  it('runCurrent populates seasons, clubs, divisions, teams, fixtures', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const leagueTable = await fixtureHtml('league-table-mixed-div-1.html');
    const fixturesAndResults = await fixtureHtml('fixtures-and-results-mens-div-1.html');

    const http = {
      fetchPage: vi.fn(async (url: string) => {
        if (url === 'https://www.calderdale.tennis-league.org/') {
          return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'home' };
        }
        if (url.includes('navButtonSelect=Directory')) {
          return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'clubs' };
        }
        if (url.includes('tabIndex=0')) {
          return { kind: 'changed' as const, status: 200, html: leagueTable, contentHash: `lt:${url}`.slice(0, 64) };
        }
        if (url.includes('displayResults.php')) {
          return { kind: 'changed' as const, status: 200, html: fixturesAndResults, contentHash: `fr:${url}`.slice(0, 64) };
        }
        // tabIndex=4 (player-rankings), match-card etc — keep no-op
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `ot:${url}`.slice(0, 64) };
      }),
    };
    const orch = createOrchestrator(getDb(), http);
    const report = await orch.runCurrent();

    expect(report.currentSeasonId).toBeGreaterThan(0);

    const db = getDb();
    const seasons = await db.select().from(schema.seasons);
    expect(seasons.filter((s) => s.current)).toHaveLength(1);

    const divisions = await db.select().from(schema.divisions);
    expect(divisions).toHaveLength(9);
    for (const d of divisions) {
      expect(d.upstreamModeId).toBeGreaterThan(0);
    }

    const teams = await db.select().from(schema.teams);
    expect(teams.length).toBeGreaterThanOrEqual(6);

    const fixtures = await db.select().from(schema.fixtures);
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      expect(f.upstreamId).not.toBeNull();
      expect(f.homeTeamId).toBeGreaterThan(0);
      expect(f.awayTeamId).toBeGreaterThan(0);
      expect(f.divisionId).toBeGreaterThan(0);
    }
  });
});
