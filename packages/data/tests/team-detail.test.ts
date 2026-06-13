import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getTeam } from '../src/teams.js';

describe('getTeam', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams, players, fixtures, results, match_cards, rubbers, team_contacts RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null for unknown slug', async () => {
    expect(await getTeam(getDb(), 'nope')).toBeNull();
  });

  it('returns team meta, contacts, fixtures, and best-effort squad', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({ slug: 'cragg-vale', canonicalName: 'Cragg Vale' }).returning();
    const [team, opp] = await db.insert(schema.teams).values([
      { slug: 'cragg-vale-a', name: 'Cragg Vale A', clubId: club!.id, divisionId: division!.id },
      { slug: 'opponent-a', name: 'Opponent A', clubId: club!.id, divisionId: division!.id },
    ]).returning();
    const [p1, p2] = await db.insert(schema.players).values([
      { slug: 'p1', name: 'Player One', clubId: club!.id },
      { slug: 'p2', name: 'Player Two', clubId: club!.id },
    ]).returning();
    await db.insert(schema.teamContacts).values({
      teamId: team!.id, name: 'Captain Cathy', role: 'Captain', phone: '01234', email: null,
    });
    // Team plays at home, has a card; its players are on the HOME side.
    const [fx] = await db.insert(schema.fixtures).values({
      upstreamId: 300, date: '2026-04-23', homeTeamId: team!.id, awayTeamId: opp!.id,
      divisionId: division!.id, status: 'completed',
    }).returning();
    await db.insert(schema.results).values({ fixtureId: fx!.id, homeScore: '6', awayScore: '3' });
    const [card] = await db.insert(schema.matchCards).values({ fixtureId: fx!.id }).returning();
    await db.insert(schema.rubbers).values({
      matchCardId: card!.id, orderInCard: 1, homePlayerIds: [p1!.id, p2!.id], awayPlayerIds: [],
    });

    const result = await getTeam(db, 'cragg-vale-a');
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('cragg-vale-a');
    expect(result!.club).toEqual({ slug: 'cragg-vale', name: 'Cragg Vale' });
    expect(result!.division).toEqual({ slug: 'mens-1', name: 'Mens Division 1' });
    expect(result!.contacts).toEqual([
      { name: 'Captain Cathy', role: 'Captain', phone: '01234', email: null },
    ]);
    expect(result!.fixtures).toHaveLength(1);
    expect(result!.fixtures[0]?.score).toEqual({ home: '6', away: '3' });
    expect(result!.squad.map((p) => p.slug).sort()).toEqual(['p1', 'p2']);
  });
});
