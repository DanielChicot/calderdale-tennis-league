import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import {
  clubs, clubAliases, seasons, divisions, players, rankings, scrapeRuns,
} from '../src/schema/index.js';

describe('rankings + scrape_runs + seed', () => {
  beforeAll(async () => {
    const { db } = await startDb();
    await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  }, 120_000);

  afterAll(async () => {
    await stopDb();
  });

  // No beforeEach truncate — the seed test must see the seeded data.
  // Each test that needs a clean state does its own targeted TRUNCATE.

  it('seed migration created the Queens club + both aliases', async () => {
    const db = getDb();
    const [queens] = await db.select().from(clubs).where(eq(clubs.slug, 'halifax-queens'));
    expect(queens).toBeDefined();
    expect(queens?.canonicalName).toBe('Queens Sports Club');
    const aliases = await db.select().from(clubAliases).where(eq(clubAliases.clubId, queens!.id));
    const names = new Set(aliases.map((a) => a.observedName));
    expect(names.has('Queens Sports Club')).toBe(true);
    expect(names.has('Halifax Queens')).toBe(true);
  });

  it('ranking accepts half-points', async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, rankings RESTART IDENTITY CASCADE`);
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({ slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1 }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [player] = await db.insert(players).values({ slug: 'p', name: 'P', clubId: club!.id }).returning();
    await db.insert(rankings).values({
      playerId: player!.id,
      divisionId: division!.id,
      rank: 1,
      rubbersWon: '12.5',
      rubbersPlayed: '20.5',
      gamesWon: 100,
      gamesPlayed: 120,
      rankingScore: '0.625',
      movement: 'up',
    });
    const [r] = await db.select().from(rankings);
    expect(r?.rubbersWon).toBe('12.5');
    expect(r?.movement).toBe('up');
  });

  it('scrape_runs upserts on URL', async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE scrape_runs`);
    await db.insert(scrapeRuns).values({
      url: 'https://example.test/page',
      lastFetchedAt: new Date(),
      lastStatus: 200,
      lastParseOk: true,
      contentHash: 'abc123',
    });
    await db.insert(scrapeRuns).values({
      url: 'https://example.test/page',
      lastFetchedAt: new Date(),
      lastStatus: 304,
      lastParseOk: true,
      contentHash: 'abc123',
    }).onConflictDoUpdate({
      target: scrapeRuns.url,
      set: { lastStatus: 304 },
    });
    const [row] = await db.select().from(scrapeRuns);
    expect(row?.lastStatus).toBe(304);
  });

  it('ranking upserts on (player_id, division_id) conflict', async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE seasons, divisions, clubs, club_aliases, teams, players, player_aliases, rankings RESTART IDENTITY CASCADE`);
    const [season] = await db.insert(seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(divisions).values({ slug: 'd', name: 'D', group: 'Mens', seasonId: season!.id, upstreamModeId: 1 }).returning();
    const [club] = await db.insert(clubs).values({ slug: 'c', canonicalName: 'C' }).returning();
    const [player] = await db.insert(players).values({ slug: 'p', name: 'P', clubId: club!.id }).returning();

    const base = {
      playerId: player!.id,
      divisionId: division!.id,
      rubbersWon: '5',
      rubbersPlayed: '8',
      gamesWon: 50,
      gamesPlayed: 80,
      movement: 'same' as const,
    };
    await db.insert(rankings).values({ ...base, rank: 9, rankingScore: '100.5' });
    await db
      .insert(rankings)
      .values({ ...base, rank: 4, rankingScore: '210.25' })
      .onConflictDoUpdate({
        target: [rankings.playerId, rankings.divisionId],
        set: { rank: 4, rankingScore: '210.25' },
      });

    const rows = await db.select().from(rankings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rank).toBe(4);
    expect(rows[0]?.rankingScore).toBe('210.25');
  });
});
