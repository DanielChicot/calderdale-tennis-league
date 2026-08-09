import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { searchPlayers } from '../src/players.js';

describe('searchPlayers', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE clubs, players RESTART IDENTITY CASCADE`);
    const [oak] = await db.insert(schema.clubs).values({ slug: 'oak', canonicalName: 'Oak' }).returning();
    const [elm] = await db.insert(schema.clubs).values({ slug: 'elm', canonicalName: 'Elm' }).returning();
    await db.insert(schema.players).values([
      { slug: 'jo-bloggs', name: 'Jo Bloggs', clubId: oak!.id },
      { slug: 'joan-blake', name: 'Joan Blake', clubId: elm!.id },
      { slug: 'sam-day', name: 'Sam Day', clubId: oak!.id },
    ]);
  });

  it('matches case-insensitively on a substring and includes the club', async () => {
    const rows = await searchPlayers(getDb(), 'blo');
    expect(rows).toEqual([{ slug: 'jo-bloggs', name: 'Jo Bloggs', club: { slug: 'oak', name: 'Oak' } }]);
  });

  it('orders results by name', async () => {
    const rows = await searchPlayers(getDb(), 'jo');
    expect(rows.map((r) => r.name)).toEqual(['Jo Bloggs', 'Joan Blake']);
  });

  it('returns empty for no match', async () => {
    expect(await searchPlayers(getDb(), 'zzz')).toEqual([]);
  });
});
