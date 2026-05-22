import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { seasons, divisions, clubs, clubAliases, teams, players, playerAliases } from '../src/schema/index.js';

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
