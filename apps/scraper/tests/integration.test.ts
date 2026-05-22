import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { createOrchestrator } from '../src/orchestrator.js';
import type { ScrapeHttpClient } from '../src/http-client.js';

const fixtureHtml = (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('scraper integration — current mode end-to-end', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores, rankings, scrape_runs RESTART IDENTITY CASCADE`);
  });

  it('populates seasons, clubs from fixtures + records scrape_runs', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');

    const http: ScrapeHttpClient = {
      fetchPage: vi.fn(async (url: string) => {
        if (url.startsWith('https://www.calderdale.tennis-league.org/?navButtonSelect=Directory')) {
          return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'b' };
        }
        if (url === 'https://www.calderdale.tennis-league.org/') {
          return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'a' };
        }
        return { kind: 'changed' as const, status: 200, html: '<html/>', contentHash: 'c' };
      }),
    };

    const orch = createOrchestrator(getDb(), http);
    const report = await orch.runCurrent();

    expect(report.parseFailures).toBe(0);

    const seasons = await getDb().select().from(schema.seasons);
    expect(seasons.length).toBeGreaterThan(0);
    const clubs = await getDb().select().from(schema.clubs);
    expect(clubs.length).toBeGreaterThan(0);
    const runs = await getDb().select().from(schema.scrapeRuns);
    expect(runs.length).toBeGreaterThan(0);
  });

  it('second run is a no-op when content hashes match', async () => {
    const seasonNav = await fixtureHtml('season-nav.html');
    const clubsDir = await fixtureHtml('clubs-directory.html');

    const http: ScrapeHttpClient = {
      fetchPage: vi.fn(async (url: string, prior) => {
        if (prior?.contentHash) {
          return { kind: 'unchanged' as const, status: 200, contentHash: prior.contentHash };
        }
        if (url === 'https://www.calderdale.tennis-league.org/') return { kind: 'changed' as const, status: 200, html: seasonNav, contentHash: 'a' };
        return { kind: 'changed' as const, status: 200, html: clubsDir, contentHash: 'b' };
      }),
    };

    const orch = createOrchestrator(getDb(), http);
    await orch.runCurrent();
    const first = await getDb().select().from(schema.clubs);
    await orch.runCurrent();
    const second = await getDb().select().from(schema.clubs);
    expect(second.length).toBe(first.length);
  });
});
