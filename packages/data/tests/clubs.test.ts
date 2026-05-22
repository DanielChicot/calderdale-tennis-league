import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getClub, listClubs } from '../src/clubs.js';

describe('clubs getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE clubs RESTART IDENTITY CASCADE`);
  });

  it('getClub returns null for unknown slug', async () => {
    expect(await getClub(getDb(), 'nope')).toBeNull();
  });

  it('getClub returns the club with canonicalName mapped to name', async () => {
    const db = getDb();
    await db.insert(schema.clubs).values({ slug: 'halifax-queens', canonicalName: 'Queens Sports Club' });
    const c = await getClub(db, 'halifax-queens');
    expect(c).toEqual({ id: expect.any(Number), slug: 'halifax-queens', name: 'Queens Sports Club' });
  });

  it('listClubs returns all rows sorted by canonical name', async () => {
    const db = getDb();
    await db.insert(schema.clubs).values([
      { slug: 'z-club', canonicalName: 'Zenith Tennis' },
      { slug: 'a-club', canonicalName: 'Anchor Tennis' },
    ]);
    const list = await listClubs(db);
    expect(list.map((c) => c.name)).toEqual(['Anchor Tennis', 'Zenith Tennis']);
  });
});
