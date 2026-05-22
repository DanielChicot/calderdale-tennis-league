import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type FixtureSummary = {
  id: number;
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  divisionId: number;
  status: string;
};

export const getFixture = async (db: Database, id: number): Promise<FixtureSummary | null> => {
  const [row] = await db.select().from(schema.fixtures).where(eq(schema.fixtures.id, id)).limit(1);
  return row ?? null;
};

export const listUpcomingFixtures = async (
  db: Database,
  divisionId: number,
  fromDate: string,
): Promise<FixtureSummary[]> => {
  return db
    .select()
    .from(schema.fixtures)
    .where(
      and(
        eq(schema.fixtures.divisionId, divisionId),
        eq(schema.fixtures.status, 'scheduled'),
        gte(schema.fixtures.date, fromDate),
      ),
    )
    .orderBy(schema.fixtures.date);
};
