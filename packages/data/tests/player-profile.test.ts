import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getPlayerProfile } from '../src/players.js';

describe('getPlayerProfile', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, match_cards, rubbers, set_scores, rankings RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null for unknown slug', async () => {
    expect(await getPlayerProfile(getDb(), 'nope')).toBeNull();
  });

  it('returns player, rankings, and match history', async () => {
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
    const [me, partner, opp1, opp2] = await db.insert(schema.players).values([
      { slug: 'me', name: 'Me Player', clubId: club!.id },
      { slug: 'partner', name: 'Partner Player', clubId: club!.id },
      { slug: 'opp1', name: 'Opp One', clubId: club!.id },
      { slug: 'opp2', name: 'Opp Two', clubId: club!.id },
    ]).returning();
    await db.insert(schema.rankings).values({
      playerId: me!.id, divisionId: division!.id, rank: 3,
      rubbersWon: '10.5', rubbersPlayed: '14', gamesWon: 100, gamesPlayed: 150, rankingScore: '480.5', movement: 'up',
    });
    const [fx] = await db.insert(schema.fixtures).values({
      upstreamId: 400, date: '2026-04-23', homeTeamId: home!.id, awayTeamId: away!.id,
      divisionId: division!.id, status: 'completed',
    }).returning();
    const [card] = await db.insert(schema.matchCards).values({ fixtureId: fx!.id }).returning();
    const [rubber] = await db.insert(schema.rubbers).values({
      matchCardId: card!.id, orderInCard: 1,
      homePlayerIds: [me!.id, partner!.id], awayPlayerIds: [opp1!.id, opp2!.id],
    }).returning();
    await db.insert(schema.setScores).values([
      { rubberId: rubber!.id, orderInRubber: 1, homeScore: 6, awayScore: 4 },
    ]);

    const profile = await getPlayerProfile(db, 'me');
    expect(profile).not.toBeNull();
    expect(profile!.player).toEqual({ slug: 'me', name: 'Me Player' });
    expect(profile!.club).toEqual({ slug: 'c', name: 'C' });
    expect(profile!.rankings).toEqual([
      { division: { slug: 'mens-1', name: 'Mens Division 1' }, rank: 3, rankingScore: '480.5', rubbersWon: '10.5', rubbersPlayed: '14' },
    ]);
    expect(profile!.matchHistory).toHaveLength(1);
    const m = profile!.matchHistory[0]!;
    expect(m.fixtureId).toBe(fx!.id);
    expect(m.division).toEqual({ slug: 'mens-1', name: 'Mens Division 1' });
    expect(m.partners.map((p) => p.slug)).toEqual(['partner']);
    expect(m.opponents.map((p) => p.slug).sort()).toEqual(['opp1', 'opp2']);
    expect(m.sets).toEqual([{ home: 6, away: 4 }]);
  });
});
