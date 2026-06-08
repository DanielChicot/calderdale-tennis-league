import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { seasons, clubs, clubAliases, players, playerAliases, divisions, teams, standings } from '../src/schema/index.js';

describe('core entities round-trip', () => {
  beforeAll(async () => {
    const { db } = await startDb();
    await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  }, 120_000);

  afterAll(async () => {
    await stopDb();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases RESTART IDENTITY CASCADE`);
  });

  it('inserts and retrieves a season', async () => {
    const db = getDb();
    const [inserted] = await db.insert(seasons).values({
      slug: 'summer-2026',
      name: 'Summer 2026',
      current: true,
    }).returning();
    const [found] = await db.select().from(seasons).where(eq(seasons.id, inserted!.id));
    expect(found).toEqual(inserted);
  });

  it('club + alias links correctly', async () => {
    const db = getDb();
    const [club] = await db.insert(clubs).values({
      slug: 'halifax-queens',
      canonicalName: 'Queens Sports Club',
    }).returning();
    await db.insert(clubAliases).values([
      { clubId: club!.id, observedName: 'Queens Sports Club' },
      { clubId: club!.id, observedName: 'Halifax Queens' },
    ]);
    const aliases = await db.select().from(clubAliases).where(eq(clubAliases.clubId, club!.id));
    expect(aliases).toHaveLength(2);
  });

  it('division enforces group enum', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    await expect(
      db.execute(sql`INSERT INTO divisions (slug, name, "group", season_id) VALUES ('d', 'D', 'Junior', ${season!.id})`),
    ).rejects.toThrow();
  });

  it('divisions.upstream_mode_id is required and unique within a season', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    await db.execute(
      sql`INSERT INTO divisions (slug, name, "group", season_id, upstream_mode_id)
          VALUES ('d1', 'D1', 'Mens', ${season!.id}, 8)`,
    );
    // Duplicate (upstream_mode_id, season_id) must be rejected
    await expect(
      db.execute(
        sql`INSERT INTO divisions (slug, name, "group", season_id, upstream_mode_id)
            VALUES ('d2', 'D2', 'Mens', ${season!.id}, 8)`,
      ),
    ).rejects.toThrow();
    // Same mode_id across a different season is fine
    const [s2] = await db.insert(seasons).values({ slug: 's2', name: 'S2', current: false }).returning();
    await db.execute(
      sql`INSERT INTO divisions (slug, name, "group", season_id, upstream_mode_id)
          VALUES ('d2', 'D2', 'Mens', ${s2!.id}, 8)`,
    );
  });

  it('teams.upstream_team_id is nullable but unique when set', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
    }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();

    // Two teams with NULL upstream_team_id — both allowed
    await db.insert(teams).values([
      { slug: 't1', name: 'T1', clubId: club!.id, divisionId: division!.id },
      { slug: 't2', name: 'T2', clubId: club!.id, divisionId: division!.id },
    ]);
    // Set first to 100 — fine
    await db.execute(sql`UPDATE teams SET upstream_team_id = 100 WHERE slug = 't1'`);
    // Setting second to 100 too — must fail
    await expect(
      db.execute(sql`UPDATE teams SET upstream_team_id = 100 WHERE slug = 't2'`),
    ).rejects.toThrow();
  });

  it('standings upsert overwrites on (team_id) conflict', async () => {
    const db = getDb();
    const [season] = await db.insert(seasons).values({ slug: 's2', name: 'S2', current: true }).returning();
    const [division] = await db.insert(divisions).values({
      slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1,
    }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [team] = await db.insert(teams).values({
      slug: 't', name: 'T', clubId: club!.id, divisionId: division!.id,
    }).returning();

    await db.insert(standings).values({
      teamId: team!.id, divisionId: division!.id,
      position: 5, resultsReceived: 2, resultsTotal: 10, pointsWon: '7.5', pointsLost: '3.5',
    });
    await db.insert(standings).values({
      teamId: team!.id, divisionId: division!.id,
      position: 3, resultsReceived: 4, resultsTotal: 10, pointsWon: '12', pointsLost: '6',
    }).onConflictDoUpdate({
      target: standings.teamId,
      set: { position: 3, resultsReceived: 4, resultsTotal: 10, pointsWon: '12', pointsLost: '6' },
    });

    const rows = await db.select().from(standings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(3);
    expect(rows[0]?.pointsWon).toBe('12');
  });

  it('player alias prevents duplicate observed names', async () => {
    const db = getDb();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [player] = await db.insert(players).values({
      slug: 'p',
      name: 'P',
      clubId: club!.id,
    }).returning();
    await db.insert(playerAliases).values({ playerId: player!.id, observedName: 'Dan Chicot' });
    await expect(
      db.insert(playerAliases).values({ playerId: player!.id, observedName: 'Dan Chicot' }),
    ).rejects.toThrow();
  });
});
