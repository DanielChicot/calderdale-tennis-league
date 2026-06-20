import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { listFixturesByDivision } from '../src/fixtures.js';

describe('listFixturesByDivision', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, fixtures, results, match_cards RESTART IDENTITY CASCADE`,
    );
  });

  const seed = async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home, away] = await db.insert(schema.teams).values([
      { slug: 'home-a', name: 'Home A', clubId: club!.id, divisionId: division!.id },
      { slug: 'away-a', name: 'Away A', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    return { db, division: division!, home: home!, away: away! };
  };

  it('returns empty for a division with no fixtures', async () => {
    const { db, division } = await seed();
    expect(await listFixturesByDivision(db, division.id)).toEqual([]);
  });

  it('returns fixtures with team names, score, and hasCard flag', async () => {
    const { db, division, home, away } = await seed();
    // A played fixture with a result + a card, and a scheduled one with neither.
    const [played] = await db.insert(schema.fixtures).values({
      upstreamId: 100, date: '2026-04-23', homeTeamId: home.id, awayTeamId: away.id,
      divisionId: division.id, status: 'completed',
    }).returning();
    await db.insert(schema.results).values({ fixtureId: played!.id, homeScore: '5.5', awayScore: '3.5' });
    await db.insert(schema.matchCards).values({ fixtureId: played!.id });
    await db.insert(schema.fixtures).values({
      upstreamId: 101, date: '2026-05-01', homeTeamId: away.id, awayTeamId: home.id,
      divisionId: division.id, status: 'scheduled',
    });

    const rows = await listFixturesByDivision(db, division.id);
    expect(rows).toHaveLength(2);

    // ordered by date — played (Apr 23) first
    expect(rows[0]).toEqual({
      id: played!.id,
      date: '2026-04-23',
      divisionSlug: 'mens-1',
      homeTeam: { slug: 'home-a', name: 'Home A' },
      awayTeam: { slug: 'away-a', name: 'Away A' },
      status: 'completed',
      score: { home: '5.5', away: '3.5' },   // half-point preserved as string
      hasCard: true,
    });
    expect(rows[1]?.score).toBeUndefined();
    expect(rows[1]?.hasCard).toBe(false);
  });
});
