import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getPlayer, listPlayersByClub } from '../src/players.js';

describe('players getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE clubs, players RESTART IDENTITY CASCADE`);
  });

  it('getPlayer returns null for unknown slug', async () => {
    expect(await getPlayer(getDb(), 'nope')).toBeNull();
  });

  it('getPlayer returns the player row by slug', async () => {
    const db = getDb();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    await db.insert(schema.players).values({ slug: 'alice-smith', name: 'Alice Smith', clubId: club!.id });
    const result = await getPlayer(db, 'alice-smith');
    expect(result).toEqual({
      id: expect.any(Number),
      slug: 'alice-smith',
      name: 'Alice Smith',
      clubId: club!.id,
    });
  });

  it('listPlayersByClub filters by clubId and sorts by name', async () => {
    const db = getDb();
    const [club1] = await db.insert(schema.clubs).values({ slug: 'c1', canonicalName: 'Club One' }).returning();
    const [club2] = await db.insert(schema.clubs).values({ slug: 'c2', canonicalName: 'Club Two' }).returning();
    await db.insert(schema.players).values([
      { slug: 'zara-jones', name: 'Zara Jones', clubId: club1!.id },
      { slug: 'alice-smith', name: 'Alice Smith', clubId: club1!.id },
      { slug: 'bob-green', name: 'Bob Green', clubId: club2!.id },
    ]);
    const results = await listPlayersByClub(db, club1!.id);
    expect(results).toHaveLength(2);
    expect(results.map((p) => p.name)).toEqual(['Alice Smith', 'Zara Jones']);
    expect(results.every((p) => p.clubId === club1!.id)).toBe(true);
  });
});
