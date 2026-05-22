import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql, eq } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { detectAndPersistSeasons } from '../src/season-detector.js';

const fixtureHtml = (name: string) =>
  readFile(resolve(__dirname, '../../../fixtures', name), 'utf8');

describe('detectAndPersistSeasons', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE seasons RESTART IDENTITY CASCADE`);
  });

  it('persists every season from the upstream nav', async () => {
    const db = getDb();
    const html = await fixtureHtml('season-nav.html');
    const result = await detectAndPersistSeasons(db, html);
    const persisted = await db.select().from(schema.seasons);
    expect(persisted.length).toBe(result.totalSeasons);
    expect(persisted.length).toBeGreaterThan(0);
  });

  it('marks exactly one season as current when a season tab is selected', async () => {
    const db = getDb();
    const html = await fixtureHtml('season-nav-current-selected.html');
    await detectAndPersistSeasons(db, html);
    const currents = await db.select().from(schema.seasons).where(eq(schema.seasons.current, true));
    expect(currents).toHaveLength(1);
  });

  it('is idempotent — running twice yields the same row count', async () => {
    const db = getDb();
    const html = await fixtureHtml('season-nav.html');
    await detectAndPersistSeasons(db, html);
    const firstCount = (await db.select().from(schema.seasons)).length;
    await detectAndPersistSeasons(db, html);
    const secondCount = (await db.select().from(schema.seasons)).length;
    expect(secondCount).toBe(firstCount);
  });
});
