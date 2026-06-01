import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { resolveClub, resolvePlayer, resolveTeam, stripTeamSuffix } from '../src/entity-resolver.js';

describe('entity-resolver', () => {
  beforeAll(async () => {
    await startDb();
  }, 120_000);
  afterAll(async () => {
    await stopDb();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases RESTART IDENTITY CASCADE`);
  });

  it('known alias → returns existing club id', async () => {
    const db = getDb();
    const [club] = await db
      .insert(schema.clubs)
      .values({ slug: 'queensbury', canonicalName: 'Queensbury TC' })
      .returning();
    await db
      .insert(schema.clubAliases)
      .values({ clubId: club!.id, observedName: 'Queensbury Tennis Club' });

    const result = await resolveClub(db, 'Queensbury Tennis Club');
    expect(result).toBe(club!.id);
  });

  it('unknown name → creates tentative club + alias', async () => {
    const db = getDb();
    const id = await resolveClub(db, 'Brand New Club');

    const clubs = await db.select().from(schema.clubs);
    expect(clubs).toHaveLength(1);
    expect(clubs[0]).toMatchObject({
      id,
      slug: 'brand-new-club',
      canonicalName: 'Brand New Club',
      needsReview: true,
    });

    const aliases = await db.select().from(schema.clubAliases);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ clubId: id, observedName: 'Brand New Club' });
  });

  it('idempotent: calling twice returns same id, no duplicate rows', async () => {
    const db = getDb();
    const id1 = await resolveClub(db, 'Idempotent Club');
    const id2 = await resolveClub(db, 'Idempotent Club');

    expect(id1).toBe(id2);

    const clubs = await db.select().from(schema.clubs);
    expect(clubs).toHaveLength(1);

    const aliases = await db.select().from(schema.clubAliases);
    expect(aliases).toHaveLength(1);
  });

  it('player tentative on unknown → creates tentative player linked to club', async () => {
    const db = getDb();
    const [club] = await db
      .insert(schema.clubs)
      .values({ slug: 'some-club', canonicalName: 'Some Club' })
      .returning();

    const playerId = await resolvePlayer(db, 'Jane Smith', club!.id);

    const players = await db.select().from(schema.players);
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({
      id: playerId,
      slug: 'jane-smith',
      name: 'Jane Smith',
      clubId: club!.id,
      needsReview: true,
    });

    const aliases = await db.select().from(schema.playerAliases);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ playerId, observedName: 'Jane Smith' });
  });

  it('resolveTeam: known club → creates team with correct club_id', async () => {
    const db = getDb();
    const [club] = await db
      .insert(schema.clubs)
      .values({ slug: 'halifax-queens', canonicalName: 'Queens Sports Club' })
      .returning();
    await db
      .insert(schema.clubAliases)
      .values({ clubId: club!.id, observedName: 'Halifax Queens' });
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db
      .insert(schema.divisions)
      .values({ slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8 })
      .returning();

    const teamId = await resolveTeam(db, 'Halifax Queens A', division!.id);

    const teams = await db.select().from(schema.teams);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      id: teamId,
      slug: 'halifax-queens-a',
      name: 'Halifax Queens A',
      clubId: club!.id,
      divisionId: division!.id,
    });
  });

  it('resolveTeam: unknown club → tentative club + team, linked', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's2', name: 'S2', current: true }).returning();
    const [division] = await db
      .insert(schema.divisions)
      .values({ slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8 })
      .returning();

    const teamId = await resolveTeam(db, 'Mystery Players B', division!.id);

    const clubs = await db.select().from(schema.clubs);
    expect(clubs).toHaveLength(1);
    expect(clubs[0]).toMatchObject({
      slug: 'mystery-players',
      canonicalName: 'Mystery Players',
      needsReview: true,
    });
    const teams = await db.select().from(schema.teams);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      id: teamId,
      slug: 'mystery-players-b',
      name: 'Mystery Players B',
      clubId: clubs[0]!.id,
      divisionId: division!.id,
    });
  });

  it('resolveTeam: idempotent — same (name, divisionId) returns same id', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's3', name: 'S3', current: true }).returning();
    const [division] = await db
      .insert(schema.divisions)
      .values({ slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8 })
      .returning();

    const id1 = await resolveTeam(db, 'Akroydon A', division!.id);
    const id2 = await resolveTeam(db, 'Akroydon A', division!.id);
    expect(id1).toBe(id2);
    const teams = await db.select().from(schema.teams);
    expect(teams).toHaveLength(1);
  });
});

describe('stripTeamSuffix', () => {
  it('strips a trailing single capital letter', () => {
    expect(stripTeamSuffix('Halifax Queens A')).toBe('Halifax Queens');
    expect(stripTeamSuffix('Halifax Queens B')).toBe('Halifax Queens');
  });

  it('returns the name unchanged when no trailing letter token', () => {
    expect(stripTeamSuffix('Akroydon')).toBe('Akroydon');
    expect(stripTeamSuffix('Halifax Queens Reserves')).toBe('Halifax Queens Reserves');
  });

  it('handles single-word club + letter ("X B")', () => {
    expect(stripTeamSuffix('X B')).toBe('X');
  });

  it('ignores trailing lowercase letters (only capital is a suffix marker)', () => {
    expect(stripTeamSuffix('Akroydon a')).toBe('Akroydon a');
  });
});
