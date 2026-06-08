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
      sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores, rankings, standings, scrape_runs RESTART IDENTITY CASCADE`,
    );
  });

  it('runCurrent populates seasons, clubs, divisions, teams, fixtures, standings, upstream_team_id', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const leagueTablePost = await fixtureHtml('league-table-mens-div-1-post.html');
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
          // divisions-discovery uses the same GET URL. Service it with the POST fixture
          // since the fixture also contains the divisions <select> dropdown.
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `disc:${url}`.slice(0, 64) };
        }
        if (url.includes('displayResults.php')) {
          return { kind: 'changed' as const, status: 200, html: fixturesAndResults, contentHash: `fr:${url}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `ot:${url}`.slice(0, 64) };
      }),
      fetchPagePost: vi.fn(async (url: string, body: string) => {
        if (url.includes('index.php') && url.includes('tabIndex=0')) {
          return { kind: 'changed' as const, status: 200, html: leagueTablePost, contentHash: `ltp:${body}`.slice(0, 64) };
        }
        return { kind: 'changed' as const, status: 200, html: '<html></html>', contentHash: `pst:${url}`.slice(0, 64) };
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

    const teamsWithUpstream = await db
      .select()
      .from(schema.teams)
      .where(sql`upstream_team_id IS NOT NULL`);
    // The Mens Div 1 fixture has 10 team-handler entries; the same fixture is served for
    // every division's league-table-post, so all matching teams (one per league-table
    // walk) get their upstream_team_id set.
    expect(teamsWithUpstream.length).toBeGreaterThanOrEqual(10);

    const standingsRows = await db.select().from(schema.standings);
    expect(standingsRows.length).toBeGreaterThanOrEqual(10);
    for (const s of standingsRows) {
      expect(s.position).toBeGreaterThanOrEqual(1);
      expect(s.divisionId).toBeGreaterThan(0);
      expect(s.teamId).toBeGreaterThan(0);
    }

    const fixtures = await db.select().from(schema.fixtures);
    expect(fixtures.length).toBeGreaterThan(0);
  });
});
