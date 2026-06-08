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

  const rows: DivisionTableRow[] = await db
    .select({
      position: schema.standings.position,
      teamId: schema.teams.id,
      teamSlug: schema.teams.slug,
      teamName: schema.teams.name,
      pointsWon: schema.standings.pointsWon,
      pointsLost: schema.standings.pointsLost,
      resultsReceived: schema.standings.resultsReceived,
      resultsTotal: schema.standings.resultsTotal,
    })
    .from(schema.standings)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.standings.teamId))
    .where(eq(schema.standings.divisionId, division.id))
    .orderBy(schema.standings.position);

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
