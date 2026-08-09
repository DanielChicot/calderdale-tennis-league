import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getPlayerPanel } from '../src/player-panel.js';

// Seeds one season/division/club, two teams, and four players; returns ids.
const seed = async () => {
  const db = getDb();
  const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
  const [division] = await db.insert(schema.divisions).values({
    slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
  }).returning();
  const [club] = await db.insert(schema.clubs).values({ slug: 'oak', canonicalName: 'Oak' }).returning();
  const [ours] = await db.insert(schema.teams).values({ slug: 'oak-a', name: 'Oak A', clubId: club!.id, divisionId: division!.id }).returning();
  const [rivals] = await db.insert(schema.teams).values({ slug: 'elm-a', name: 'Elm A', clubId: club!.id, divisionId: division!.id }).returning();
  const [me] = await db.insert(schema.players).values({ slug: 'jo-bloggs', name: 'Jo Bloggs', clubId: club!.id }).returning();
  const [partner] = await db.insert(schema.players).values({ slug: 'sam-day', name: 'Sam Day', clubId: club!.id }).returning();
  const [oppA] = await db.insert(schema.players).values({ slug: 'ann-oa', name: 'Ann Oa', clubId: club!.id }).returning();
  const [oppB] = await db.insert(schema.players).values({ slug: 'bob-ob', name: 'Bob Ob', clubId: club!.id }).returning();
  return { db, season: season!, division: division!, club: club!, ours: ours!, rivals: rivals!, me: me!, partner: partner!, oppA: oppA!, oppB: oppB! };
};

// Creates a completed fixture with one rubber (and optional set scores) on it.
const playFixture = async (
  db: ReturnType<typeof getDb>,
  args: {
    date: string; divisionId: number; homeTeamId: number; awayTeamId: number;
    homeIds: number[]; awayIds: number[]; sets: [number, number][];
  },
) => {
  const [fixture] = await db.insert(schema.fixtures).values({
    date: args.date, homeTeamId: args.homeTeamId, awayTeamId: args.awayTeamId,
    divisionId: args.divisionId, status: 'completed',
  }).returning();
  const [card] = await db.insert(schema.matchCards).values({ fixtureId: fixture!.id }).returning();
  const [rubber] = await db.insert(schema.rubbers).values({
    matchCardId: card!.id, orderInCard: 1, homePlayerIds: args.homeIds, awayPlayerIds: args.awayIds,
  }).returning();
  for (const [i, [home, away]] of args.sets.entries()) {
    await db.insert(schema.setScores).values({ rubberId: rubber!.id, orderInRubber: i + 1, homeScore: home, awayScore: away });
  }
  return fixture!;
};

describe('getPlayerPanel', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, match_cards, rubbers, set_scores, standings, rankings RESTART IDENTITY CASCADE`);
  });

  it('returns null for an unknown slug', async () => {
    expect(await getPlayerPanel(getDb(), 'nobody', '2026-08-09')).toBeNull();
  });

  it('builds the full panel: last result, record, team standing, ranking, next fixture', async () => {
    const s = await seed();
    // Older loss (away side, 0–2).
    await playFixture(s.db, {
      date: '2026-07-01', divisionId: s.division.id, homeTeamId: s.rivals.id, awayTeamId: s.ours.id,
      homeIds: [s.oppA.id, s.oppB.id], awayIds: [s.me.id, s.partner.id], sets: [[6, 3], [6, 4]],
    });
    // Latest win (home side, 2–0).
    await playFixture(s.db, {
      date: '2026-07-08', divisionId: s.division.id, homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      homeIds: [s.me.id, s.partner.id], awayIds: [s.oppA.id, s.oppB.id], sets: [[6, 1], [6, 4]],
    });
    // Team standing + player ranking + one future scheduled fixture.
    await s.db.insert(schema.standings).values({
      teamId: s.ours.id, divisionId: s.division.id, position: 2,
      resultsReceived: 2, resultsTotal: 18, pointsWon: '10', pointsLost: '6',
    });
    await s.db.insert(schema.rankings).values({
      playerId: s.me.id, divisionId: s.division.id, rank: 4,
      rubbersWon: '1', rubbersPlayed: '2', gamesWon: 24, gamesPlayed: 40,
      rankingScore: '55.00', movement: 'up',
    });
    const upcoming = await s.db.insert(schema.fixtures).values({
      date: '2026-08-14', homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      divisionId: s.division.id, status: 'scheduled',
    }).returning();

    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel).not.toBeNull();
    expect(panel!.player).toEqual({ slug: 'jo-bloggs', name: 'Jo Bloggs' });
    expect(panel!.club).toEqual({ slug: 'oak', name: 'Oak' });
    expect(panel!.lastResult).toMatchObject({
      date: '2026-07-08', outcome: 'W', setsFor: 2, setsAgainst: 0,
      opponentTeam: { slug: 'elm-a', name: 'Elm A', divisionSlug: 'mens-1' },
    });
    expect(panel!.seasonRecord).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect(panel!.team).toEqual({ slug: 'oak-a', name: 'Oak A', divisionSlug: 'mens-1', position: 2 });
    expect(panel!.primaryRanking).toEqual({ division: { slug: 'mens-1', name: 'Mens Division 1' }, rank: 4, movement: 'up' });
    expect(panel!.otherRankings).toEqual([]);
    expect(panel!.nextFixture).toMatchObject({
      fixtureId: upcoming[0]!.id, date: '2026-08-14', home: true, opponent: { slug: 'elm-a', name: 'Elm A' },
    });
  });

  it('handles a player with no rubbers: null result/team/next, zero record, ranking still shown', async () => {
    const s = await seed();
    await s.db.insert(schema.rankings).values({
      playerId: s.me.id, divisionId: s.division.id, rank: 9,
      rubbersWon: '0', rubbersPlayed: '0', gamesWon: 0, gamesPlayed: 0,
      rankingScore: '0.00', movement: 'new',
    });
    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel!.lastResult).toBeNull();
    expect(panel!.team).toBeNull();
    expect(panel!.nextFixture).toBeNull();
    expect(panel!.seasonRecord).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(panel!.primaryRanking).toEqual({ division: { slug: 'mens-1', name: 'Mens Division 1' }, rank: 9, movement: 'new' });
  });

  it('counts a 1–1 two-set rubber as a draw and reports outcome D', async () => {
    const s = await seed();
    await playFixture(s.db, {
      date: '2026-07-08', divisionId: s.division.id, homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      homeIds: [s.me.id, s.partner.id], awayIds: [s.oppA.id, s.oppB.id], sets: [[6, 3], [4, 6]],
    });
    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel!.lastResult!.outcome).toBe('D');
    expect(panel!.seasonRecord).toEqual({ wins: 0, losses: 0, draws: 1 });
  });

  it('derives the team from the most recent rubber when the player appears for two teams', async () => {
    const s = await seed();
    const [oakB] = await s.db.insert(schema.teams).values({ slug: 'oak-b', name: 'Oak B', clubId: s.club.id, divisionId: s.division.id }).returning();
    await playFixture(s.db, {
      date: '2026-07-01', divisionId: s.division.id, homeTeamId: s.ours.id, awayTeamId: s.rivals.id,
      homeIds: [s.me.id, s.partner.id], awayIds: [s.oppA.id, s.oppB.id], sets: [[6, 1], [6, 1]],
    });
    // Most recent appearance is for Oak B (away side).
    await playFixture(s.db, {
      date: '2026-07-15', divisionId: s.division.id, homeTeamId: s.rivals.id, awayTeamId: oakB!.id,
      homeIds: [s.oppA.id, s.oppB.id], awayIds: [s.me.id, s.partner.id], sets: [[6, 4], [3, 6], [10, 6]],
    });
    const panel = await getPlayerPanel(s.db, 'jo-bloggs', '2026-08-09');
    expect(panel!.team!.slug).toBe('oak-b');
    expect(panel!.lastResult).toMatchObject({ outcome: 'L', setsFor: 1, setsAgainst: 2 });
  });
});
