import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getFixture, listUpcomingFixtures } from '../src/fixtures.js';

describe('fixtures getters', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, teams, fixtures RESTART IDENTITY CASCADE`);
  });

  it('getFixture returns null for unknown id', async () => {
    expect(await getFixture(getDb(), 999)).toBeNull();
  });

  it('getFixture returns the fixture row by id', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home] = await db.insert(schema.teams).values({ slug: 'home', name: 'Home', clubId: club!.id, divisionId: division!.id }).returning();
    const [away] = await db.insert(schema.teams).values({ slug: 'away', name: 'Away', clubId: club!.id, divisionId: division!.id }).returning();
    const [fixture] = await db.insert(schema.fixtures).values({
      date: '2026-07-01',
      homeTeamId: home!.id,
      awayTeamId: away!.id,
      divisionId: division!.id,
      status: 'scheduled',
    }).returning();
    const result = await getFixture(db, fixture!.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(fixture!.id);
    expect(result!.date).toBe('2026-07-01');
    expect(result!.status).toBe('scheduled');
  });

  it('listUpcomingFixtures filters by date and status', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home] = await db.insert(schema.teams).values({ slug: 'home', name: 'Home', clubId: club!.id, divisionId: division!.id }).returning();
    const [away] = await db.insert(schema.teams).values({ slug: 'away', name: 'Away', clubId: club!.id, divisionId: division!.id }).returning();

    // Early scheduled (before fromDate — should be excluded)
    await db.insert(schema.fixtures).values({
      date: '2026-05-01',
      homeTeamId: home!.id,
      awayTeamId: away!.id,
      divisionId: division!.id,
      status: 'scheduled',
    });
    // Late scheduled (on/after fromDate — should be included)
    const [late] = await db.insert(schema.fixtures).values({
      date: '2026-06-15',
      homeTeamId: home!.id,
      awayTeamId: away!.id,
      divisionId: division!.id,
      status: 'scheduled',
    }).returning();
    // Late completed (on/after fromDate but wrong status — should be excluded)
    await db.insert(schema.fixtures).values({
      date: '2026-06-20',
      homeTeamId: home!.id,
      awayTeamId: away!.id,
      divisionId: division!.id,
      status: 'completed',
    });

    const results = await listUpcomingFixtures(db, division!.id, '2026-06-01');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(late!.id);
    expect(results[0]!.status).toBe('scheduled');
    expect(results[0]!.date).toBe('2026-06-15');
  });
});
