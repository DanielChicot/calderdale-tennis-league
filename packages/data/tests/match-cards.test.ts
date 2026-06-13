import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getMatchCard } from '../src/match-cards.js';

describe('getMatchCard', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, results, match_cards, rubbers, set_scores RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null when the fixture has no card', async () => {
    const db = getDb();
    expect(await getMatchCard(db, 999)).toBeNull();
  });

  it('returns fixture meta, rubbers with player names, and set scores', async () => {
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
    const [p1, p2, p3, p4] = await db.insert(schema.players).values([
      { slug: 'p1', name: 'Player One', clubId: club!.id },
      { slug: 'p2', name: 'Player Two', clubId: club!.id },
      { slug: 'p3', name: 'Player Three', clubId: club!.id },
      { slug: 'p4', name: 'Player Four', clubId: club!.id },
    ]).returning();
    const [fx] = await db.insert(schema.fixtures).values({
      upstreamId: 200, date: '2026-04-23', homeTeamId: home!.id, awayTeamId: away!.id,
      divisionId: division!.id, status: 'completed',
    }).returning();
    await db.insert(schema.results).values({ fixtureId: fx!.id, homeScore: '6', awayScore: '3' });
    const [card] = await db.insert(schema.matchCards).values({ fixtureId: fx!.id }).returning();
    const [rubber] = await db.insert(schema.rubbers).values({
      matchCardId: card!.id, orderInCard: 1,
      homePlayerIds: [p1!.id, p2!.id], awayPlayerIds: [p3!.id, p4!.id],
    }).returning();
    await db.insert(schema.setScores).values([
      { rubberId: rubber!.id, orderInRubber: 1, homeScore: 6, awayScore: 4 },
      { rubberId: rubber!.id, orderInRubber: 2, homeScore: 6, awayScore: 2 },
    ]);

    const card_ = await getMatchCard(db, fx!.id);
    expect(card_).not.toBeNull();
    expect(card_!.fixture).toEqual({
      id: fx!.id,
      date: '2026-04-23',
      division: { slug: 'mens-1', name: 'Mens Division 1' },
      homeTeam: { slug: 'home-a', name: 'Home A' },
      awayTeam: { slug: 'away-a', name: 'Away A' },
      score: { home: '6', away: '3' },
    });
    expect(card_!.rubbers).toHaveLength(1);
    expect(card_!.rubbers[0]).toEqual({
      orderInCard: 1,
      homePlayers: [{ slug: 'p1', name: 'Player One' }, { slug: 'p2', name: 'Player Two' }],
      awayPlayers: [{ slug: 'p3', name: 'Player Three' }, { slug: 'p4', name: 'Player Four' }],
      sets: [{ home: 6, away: 4 }, { home: 6, away: 2 }],
    });
  });
});
