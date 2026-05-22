import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getCurrentSeason, listSeasons } from '../src/seasons.js';

describe('seasons getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons RESTART IDENTITY CASCADE`);
  });

  it('getCurrentSeason returns null when no current season exists', async () => {
    expect(await getCurrentSeason(getDb())).toBeNull();
  });

  it('getCurrentSeason returns the one row marked current', async () => {
    const db = getDb();
    await db.insert(schema.seasons).values([
      { slug: 'summer-2025', name: 'Summer 2025', current: false },
      { slug: 'summer-2026', name: 'Summer 2026', current: true },
    ]);
    const s = await getCurrentSeason(db);
    expect(s?.slug).toBe('summer-2026');
  });

  it('listSeasons returns all rows', async () => {
    const db = getDb();
    await db.insert(schema.seasons).values([
      { slug: 'summer-2025', name: 'Summer 2025', current: false },
      { slug: 'summer-2026', name: 'Summer 2026', current: true },
    ]);
    expect(await listSeasons(db)).toHaveLength(2);
  });
});
