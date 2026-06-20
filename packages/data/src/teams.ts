import { aliasedTable, and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import type { FixtureRow } from './fixtures.js';
import type { PlayerRef } from './match-cards.js';

export type TeamContact = {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
};

export type TeamDetail = {
  slug: string;
  name: string;
  club: { slug: string; name: string };
  division: { slug: string; name: string };
  contacts: TeamContact[];
  fixtures: FixtureRow[];
  squad: PlayerRef[];
};

// Team slugs are only unique within a division (a club's "A" team can appear in
// the Mens, Ladies and Mixed competitions), so a team is addressed by the pair
// (divisionSlug, slug) — never by slug alone.
export const getTeam = async (
  db: Database,
  divisionSlug: string,
  slug: string,
): Promise<TeamDetail | null> => {
  const [team] = await db
    .select({
      id: schema.teams.id,
      slug: schema.teams.slug,
      name: schema.teams.name,
      clubSlug: schema.clubs.slug,
      clubName: schema.clubs.canonicalName,
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
    })
    .from(schema.teams)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.teams.clubId))
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.teams.divisionId))
    .where(and(eq(schema.teams.slug, slug), eq(schema.divisions.slug, divisionSlug)))
    .limit(1);
  if (!team) return null;

  const contacts: TeamContact[] = await db
    .select({
      name: schema.teamContacts.name,
      role: schema.teamContacts.role,
      phone: schema.teamContacts.phone,
      email: schema.teamContacts.email,
    })
    .from(schema.teamContacts)
    .where(eq(schema.teamContacts.teamId, team.id));

  // Fixtures where this team is home OR away — same shape as listFixturesByDivision.
  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const fxRows = await db
    .select({
      id: schema.fixtures.id,
      date: schema.fixtures.date,
      status: schema.fixtures.status,
      divSlug: schema.divisions.slug,
      homeSlug: home.slug, homeName: home.name,
      awaySlug: away.slug, awayName: away.name,
      homeScore: schema.results.homeScore,
      awayScore: schema.results.awayScore,
      cardId: schema.matchCards.id,
    })
    .from(schema.fixtures)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
    .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
    .leftJoin(schema.results, eq(schema.results.fixtureId, schema.fixtures.id))
    .leftJoin(schema.matchCards, eq(schema.matchCards.fixtureId, schema.fixtures.id))
    .where(or(eq(schema.fixtures.homeTeamId, team.id), eq(schema.fixtures.awayTeamId, team.id)))
    .orderBy(schema.fixtures.date);
  const fixtures: FixtureRow[] = fxRows.map((r) => ({
    id: r.id,
    date: r.date,
    divisionSlug: r.divSlug,
    homeTeam: { slug: r.homeSlug, name: r.homeName },
    awayTeam: { slug: r.awaySlug, name: r.awayName },
    status: r.status,
    ...(r.homeScore != null && r.awayScore != null ? { score: { home: r.homeScore, away: r.awayScore } } : {}),
    hasCard: r.cardId != null,
  }));

  // Best-effort squad: players in this team's match-card rubbers, home side when
  // the team was home, away side when away.
  const cards = await db
    .select({
      cardId: schema.matchCards.id,
      isHome: sql<boolean>`${schema.fixtures.homeTeamId} = ${team.id}`,
    })
    .from(schema.matchCards)
    .innerJoin(schema.fixtures, eq(schema.fixtures.id, schema.matchCards.fixtureId))
    .where(or(eq(schema.fixtures.homeTeamId, team.id), eq(schema.fixtures.awayTeamId, team.id)));
  const isHomeByCard = new Map(cards.map((c) => [c.cardId, c.isHome]));
  const cardIds = cards.map((c) => c.cardId);
  const rubberRows = cardIds.length
    ? await db.select().from(schema.rubbers).where(inArray(schema.rubbers.matchCardId, cardIds))
    : [];
  const squadIds = new Set<number>();
  for (const r of rubberRows) {
    const ids = isHomeByCard.get(r.matchCardId) ? r.homePlayerIds : r.awayPlayerIds;
    for (const id of ids) squadIds.add(id);
  }
  const squad: PlayerRef[] = squadIds.size
    ? await db
        .select({ slug: schema.players.slug, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.id, [...squadIds]))
        .orderBy(schema.players.name)
    : [];

  return {
    slug: team.slug,
    name: team.name,
    club: { slug: team.clubSlug, name: team.clubName },
    division: { slug: team.divSlug, name: team.divName },
    contacts,
    fixtures,
    squad,
  };
};
