import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getDivisionTable, listDivisions } from '../src/divisions.js';

describe('divisions getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, teams, standings RESTART IDENTITY CASCADE`);
  });

  it('listDivisions returns divisions for the season ordered by name', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    await db.insert(schema.divisions).values([
      { slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 1 },
      { slug: 'mens-2', name: 'Mens Division 2', group: 'Mens', seasonId: season!.id, upstreamModeId: 2 },
    ]);
    const list = await listDivisions(db, season!.id);
    expect(list.map((d) => d.slug)).toEqual(['mens-1', 'mens-2']);
  });

  it('getDivisionTable returns null for unknown slug', async () => {
    expect(await getDivisionTable(getDb(), 'nope')).toBeNull();
  });

  it('getDivisionTable returns ordered rows for a known division', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [a, b] = await db.insert(schema.teams).values([
      { slug: 'a-team', name: 'A Team', clubId: club!.id, divisionId: division!.id },
      { slug: 'b-team', name: 'B Team', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    await db.insert(schema.standings).values([
      { teamId: a!.id, divisionId: division!.id, position: 2, resultsReceived: 1, resultsTotal: 5, pointsWon: '3', pointsLost: '2' },
      { teamId: b!.id, divisionId: division!.id, position: 1, resultsReceived: 2, resultsTotal: 5, pointsWon: '4', pointsLost: '1' },
    ]);
    const result = await getDivisionTable(db, 'mens-1');
    expect(result?.division.slug).toBe('mens-1');
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0]?.teamName).toBe('B Team');
    expect(result?.rows[0]?.position).toBe(1);
    expect(result?.rows[1]?.teamName).toBe('A Team');
    expect(result?.rows[1]?.position).toBe(2);
  });
});
