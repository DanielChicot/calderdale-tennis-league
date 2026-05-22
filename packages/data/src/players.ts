import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type PlayerSummary = {
  id: number;
  slug: string;
  name: string;
  clubId: number;
};

export const getPlayer = async (db: Database, slug: string): Promise<PlayerSummary | null> => {
  const [row] = await db
    .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name, clubId: schema.players.clubId })
    .from(schema.players)
    .where(eq(schema.players.slug, slug))
    .limit(1);
  return row ?? null;
};

export const listPlayersByClub = async (db: Database, clubId: number): Promise<PlayerSummary[]> => {
  return db
    .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name, clubId: schema.players.clubId })
    .from(schema.players)
    .where(eq(schema.players.clubId, clubId))
    .orderBy(schema.players.name);
};
