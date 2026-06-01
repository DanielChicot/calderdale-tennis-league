import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import {
  seasons, divisions, clubs, teams,
  fixtures, results, matchCards, rubbers, setScores,
} from '../src/schema/index.js';

describe('match data round-trip', () => {
  beforeAll(async () => {
    const { db } = await startDb();
    await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  }, 120_000);

  afterAll(async () => {
    await stopDb();
  });

  let homeTeamId: number;
  let awayTeamId: number;
  let divisionId: number;

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, fixtures, results, match_cards, rubbers, set_scores RESTART IDENTITY CASCADE`);
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({ slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1 }).returning();
    divisionId = division!.id;
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [home, away] = await db.insert(teams).values([
      { slug: 'home', name: 'Home', clubId: club!.id, divisionId },
      { slug: 'away', name: 'Away', clubId: club!.id, divisionId },
    ]).returning();
    homeTeamId = home!.id;
    awayTeamId = away!.id;
  });

  it('persists a played fixture with half-point score', async () => {
    const db = getDb();
    const [fixture] = await db.insert(fixtures).values({
      date: '2026-05-12',
      homeTeamId,
      awayTeamId,
      divisionId,
      status: 'completed',
    }).returning();
    await db.insert(results).values({
      fixtureId: fixture!.id,
      homeScore: '6.5',
      awayScore: '5.5',
    });
    const [result] = await db.select().from(results).where(eq(results.fixtureId, fixture!.id));
    expect(result?.homeScore).toBe('6.5');
    expect(result?.awayScore).toBe('5.5');
  });

  it('match card with rubbers and set scores cascades cleanly', async () => {
    const db = getDb();
    const [fixture] = await db.insert(fixtures).values({
      date: '2026-05-12', homeTeamId, awayTeamId, divisionId, status: 'completed',
    }).returning();
    const [card] = await db.insert(matchCards).values({ fixtureId: fixture!.id }).returning();
    const [rubber] = await db.insert(rubbers).values({
      matchCardId: card!.id,
      orderInCard: 1,
      homePlayerIds: [1, 2],
      awayPlayerIds: [3, 4],
    }).returning();
    await db.insert(setScores).values([
      { rubberId: rubber!.id, orderInRubber: 1, homeScore: 6, awayScore: 3 },
      { rubberId: rubber!.id, orderInRubber: 2, homeScore: 4, awayScore: 6 },
      { rubberId: rubber!.id, orderInRubber: 3, homeScore: 7, awayScore: 5 },
    ]);

    const sets = await db.select().from(setScores).where(eq(setScores.rubberId, rubber!.id));
    expect(sets).toHaveLength(3);

    // Cascade delete: dropping the match card should clear rubbers + set scores.
    await db.delete(matchCards).where(eq(matchCards.id, card!.id));
    const remaining = await db.select().from(setScores);
    expect(remaining).toHaveLength(0);
  });
});
