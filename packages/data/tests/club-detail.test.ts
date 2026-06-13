import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { startDb, stopDb, getDb } from './setup.js';
import { schema } from '@ctl/db';
import { getClubDetail } from '../src/clubs.js';

describe('getClubDetail', () => {
  beforeAll(async () => { await startDb(); }, 120_000);
  afterAll(async () => { await stopDb(); });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE seasons, divisions, clubs, teams RESTART IDENTITY CASCADE`,
    );
  });

  it('returns null for unknown slug', async () => {
    expect(await getClubDetail(getDb(), 'nope')).toBeNull();
  });

  it('returns club with location and its teams', async () => {
    const db = getDb();
    const [season] = await db.insert(schema.seasons).values({ slug: 's', name: 'S', current: true }).returning();
    const [division] = await db.insert(schema.divisions).values({
      slug: 'mens-1', name: 'Mens Division 1', group: 'Mens', seasonId: season!.id, upstreamModeId: 8,
    }).returning();
    const [club] = await db.insert(schema.clubs).values({
      slug: 'cragg-vale', canonicalName: 'Cragg Vale',
      address: 'Hinchcliffe Arms, Cragg Vale', postcode: 'HX7 5TA', lat: '53.7', lng: '-2.0',
    }).returning();
    await db.insert(schema.teams).values([
      { slug: 'cragg-vale-a', name: 'Cragg Vale A', clubId: club!.id, divisionId: division!.id },
      { slug: 'cragg-vale-b', name: 'Cragg Vale B', clubId: club!.id, divisionId: division!.id },
    ]);

    const result = await getClubDetail(db, 'cragg-vale');
    expect(result).toEqual({
      slug: 'cragg-vale',
      name: 'Cragg Vale',
      address: 'Hinchcliffe Arms, Cragg Vale',
      postcode: 'HX7 5TA',
      lat: '53.7',
      lng: '-2.0',
      teams: [
        { slug: 'cragg-vale-a', name: 'Cragg Vale A', division: { slug: 'mens-1', name: 'Mens Division 1' } },
        { slug: 'cragg-vale-b', name: 'Cragg Vale B', division: { slug: 'mens-1', name: 'Mens Division 1' } },
      ],
    });
  });
});
