import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type DivisionSummary = {
  id: number;
  slug: string;
  name: string;
  group: 'Mens' | 'Ladies' | 'Mixed';
  seasonId: number;
};

export type DivisionTableRow = {
  position: number;
  teamId: number;
  teamSlug: string;
  teamName: string;
  pointsWon: string;
  pointsLost: string;
  resultsReceived: number;
  resultsTotal: number;
};

export type DivisionTable = {
  division: DivisionSummary;
  rows: DivisionTableRow[];
};

export const listDivisions = async (db: Database, seasonId: number): Promise<DivisionSummary[]> => {
  return db
    .select({
      id: schema.divisions.id,
      slug: schema.divisions.slug,
      name: schema.divisions.name,
      group: schema.divisions.group,
      seasonId: schema.divisions.seasonId,
    })
    .from(schema.divisions)
    .where(eq(schema.divisions.seasonId, seasonId))
    .orderBy(schema.divisions.name);
};

export const getDivisionTable = async (db: Database, slug: string): Promise<DivisionTable | null> => {
  const [division] = await db
    .select()
    .from(schema.divisions)
    .where(eq(schema.divisions.slug, slug))
    .limit(1);
  if (!division) return null;

  const teams = await db
    .select({
      id: schema.teams.id,
      slug: schema.teams.slug,
      name: schema.teams.name,
    })
    .from(schema.teams)
    .where(eq(schema.teams.divisionId, division.id))
    .orderBy(schema.teams.name);

  const rows: DivisionTableRow[] = teams.map((t, i) => ({
    position: i + 1,
    teamId: t.id,
    teamSlug: t.slug,
    teamName: t.name,
    pointsWon: '0',
    pointsLost: '0',
    resultsReceived: 0,
    resultsTotal: 0,
  }));

  return {
    division: {
      id: division.id,
      slug: division.slug,
      name: division.name,
      group: division.group,
      seasonId: division.seasonId,
    },
    rows,
  };
};
