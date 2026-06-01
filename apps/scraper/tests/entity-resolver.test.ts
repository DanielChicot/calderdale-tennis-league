import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { resolveClub, resolvePlayer, stripTeamSuffix } from '../src/entity-resolver.js';

describe('entity-resolver', () => {
  beforeAll(async () => {
    await startDb();
  }, 120_000);
  afterAll(async () => {
    await stopDb();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE clubs RESTART IDENTITY CASCADE`);
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
