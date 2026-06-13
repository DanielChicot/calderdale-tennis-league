import { aliasedTable, and, eq, gte } from 'drizzle-orm';
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

export type FixtureRow = {
  id: number;
  date: string;
  homeTeam: { slug: string; name: string };
  awayTeam: { slug: string; name: string };
  status: string;
  score?: { home: string; away: string };
  hasCard: boolean;
};

const mapFixtureRow = (r: {
  id: number; date: string; status: string;
  homeSlug: string; homeName: string; awaySlug: string; awayName: string;
  homeScore: string | null; awayScore: string | null; cardId: number | null;
}): FixtureRow => ({
  id: r.id,
  date: r.date,
  homeTeam: { slug: r.homeSlug, name: r.homeName },
  awayTeam: { slug: r.awaySlug, name: r.awayName },
  status: r.status,
  ...(r.homeScore != null && r.awayScore != null ? { score: { home: r.homeScore, away: r.awayScore } } : {}),
  hasCard: r.cardId != null,
});

export const listFixturesByDivision = async (db: Database, divisionId: number): Promise<FixtureRow[]> => {
  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const rows = await db
    .select({
      id: schema.fixtures.id,
      date: schema.fixtures.date,
      status: schema.fixtures.status,
      homeSlug: home.slug, homeName: home.name,
      awaySlug: away.slug, awayName: away.name,
      homeScore: schema.results.homeScore,
      awayScore: schema.results.awayScore,
      cardId: schema.matchCards.id,
    })
    .from(schema.fixtures)
    .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
    .leftJoin(schema.results, eq(schema.results.fixtureId, schema.fixtures.id))
    .leftJoin(schema.matchCards, eq(schema.matchCards.fixtureId, schema.fixtures.id))
    .where(eq(schema.fixtures.divisionId, divisionId))
    .orderBy(schema.fixtures.date);
  return rows.map(mapFixtureRow);
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
