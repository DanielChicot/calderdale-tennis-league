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

export type ClubDetail = {
  slug: string;
  name: string;
  address: string | null;
  postcode: string | null;
  lat: string | null;
  lng: string | null;
  teams: { slug: string; name: string; division: { slug: string; name: string } }[];
};

export const getClubDetail = async (db: Database, slug: string): Promise<ClubDetail | null> => {
  const [club] = await db
    .select({
      id: schema.clubs.id,
      slug: schema.clubs.slug,
      name: schema.clubs.canonicalName,
      address: schema.clubs.address,
      postcode: schema.clubs.postcode,
      lat: schema.clubs.lat,
      lng: schema.clubs.lng,
    })
    .from(schema.clubs)
    .where(eq(schema.clubs.slug, slug))
    .limit(1);
  if (!club) return null;

  const teams = await db
    .select({
      slug: schema.teams.slug,
      name: schema.teams.name,
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
    })
    .from(schema.teams)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.teams.divisionId))
    .where(eq(schema.teams.clubId, club.id))
    .orderBy(schema.teams.name);

  return {
    slug: club.slug,
    name: club.name,
    address: club.address,
    postcode: club.postcode,
    lat: club.lat,
    lng: club.lng,
    teams: teams.map((t) => ({ slug: t.slug, name: t.name, division: { slug: t.divSlug, name: t.divName } })),
  };
};
