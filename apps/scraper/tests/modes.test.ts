import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { createOrchestrator } from '../src/orchestrator.js';

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

  it('runCurrent populates seasons and runs without throwing', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');
    const http = {
      fetchPage: vi.fn(async (url: string) => {
        if (url === 'https://www.calderdale.tennis-league.org/') {
          return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'a' };
        }
        return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'b' };
      }),
    };
    const orch = createOrchestrator(getDb(), http);
    const report = await orch.runCurrent();
    expect(report.currentSeasonId).toBe(0); // bare-home fixture has no season selected
  });
});
