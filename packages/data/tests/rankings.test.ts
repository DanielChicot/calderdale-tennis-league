import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getRankingsByDivision } from '../src/rankings.js';

describe('rankings getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, players, rankings RESTART IDENTITY CASCADE`);
  });

  it('getRankingsByDivision returns empty array for unknown division', async () => {
    const results = await getRankingsByDivision(getDb(), 999);
    expect(results).toEqual([]);
  });

  it('getRankingsByDivision returns rows joined with player names ordered by rank', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [alice] = await db.insert(schema.players).values({ slug: 'alice', name: 'Alice', clubId: club!.id }).returning();
    const [bob] = await db.insert(schema.players).values({ slug: 'bob', name: 'Bob', clubId: club!.id }).returning();

    await db.insert(schema.rankings).values([
      {
        playerId: bob!.id,
        divisionId: division!.id,
        rank: 2,
        rubbersWon: '8',
        rubbersPlayed: '10',
        gamesWon: 40,
        gamesPlayed: 50,
        rankingScore: '0.800',
        movement: 'same',
      },
      {
        playerId: alice!.id,
        divisionId: division!.id,
        rank: 1,
        rubbersWon: '9',
        rubbersPlayed: '10',
        gamesWon: 45,
        gamesPlayed: 50,
        rankingScore: '0.900',
        movement: 'up',
      },
    ]);

    const results = await getRankingsByDivision(db, division!.id);
    expect(results).toHaveLength(2);
    expect(results[0]!.rank).toBe(1);
    expect(results[0]!.playerName).toBe('Alice');
    expect(results[1]!.rank).toBe(2);
    expect(results[1]!.playerName).toBe('Bob');
  });

  it('getRankingsByDivision correctly returns rubbersWon as half-points string', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [player] = await db.insert(schema.players).values({ slug: 'alice', name: 'Alice', clubId: club!.id }).returning();

    await db.insert(schema.rankings).values({
      playerId: player!.id,
      divisionId: division!.id,
      rank: 1,
      rubbersWon: '12.5',
      rubbersPlayed: '20',
      gamesWon: 60,
      gamesPlayed: 100,
      rankingScore: '0.625',
      movement: 'new',
    });

    const results = await getRankingsByDivision(db, division!.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.rubbersWon).toBe('12.5');
    expect(results[0]!.movement).toBe('new');
  });
});
