import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type ClubSummary = {
  id: number;
  slug: string;
  name: string;
};

export const getClub = async (db: Database, slug: string): Promise<ClubSummary | null> => {
  const [row] = await db.select({
    id: schema.clubs.id,
    slug: schema.clubs.slug,
    name: schema.clubs.canonicalName,
  }).from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);
  return row ?? null;
};

export const listClubs = async (db: Database): Promise<ClubSummary[]> => {
  return db.select({
    id: schema.clubs.id,
    slug: schema.clubs.slug,
    name: schema.clubs.canonicalName,
  }).from(schema.clubs).orderBy(schema.clubs.canonicalName);
};
