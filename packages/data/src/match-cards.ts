import { aliasedTable, eq, inArray } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type PlayerRef = { slug: string; name: string };

export type MatchCardRubber = {
  orderInCard: number;
  homePlayers: PlayerRef[];
  awayPlayers: PlayerRef[];
  sets: { home: number; away: number }[];
};

export type MatchCardDetail = {
  fixture: {
    id: number;
    date: string;
    division: { slug: string; name: string };
    homeTeam: { slug: string; name: string };
    awayTeam: { slug: string; name: string };
    score?: { home: string; away: string };
  };
  rubbers: MatchCardRubber[];
};

export const getMatchCard = async (db: Database, fixtureId: number): Promise<MatchCardDetail | null> => {
  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const [fx] = await db
    .select({
      id: schema.fixtures.id,
      date: schema.fixtures.date,
      divSlug: schema.divisions.slug, divName: schema.divisions.name,
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
    .innerJoin(schema.matchCards, eq(schema.matchCards.fixtureId, schema.fixtures.id))
    .where(eq(schema.fixtures.id, fixtureId))
    .limit(1);
  if (!fx) return null;

  const rubberRows = await db
    .select()
    .from(schema.rubbers)
    .where(eq(schema.rubbers.matchCardId, fx.cardId))
    .orderBy(schema.rubbers.orderInCard);

  // Resolve all player ids across the card in one query.
  const allIds = [...new Set(rubberRows.flatMap((r) => [...r.homePlayerIds, ...r.awayPlayerIds]))];
  const playerRows = allIds.length
    ? await db
        .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.id, allIds))
    : [];
  const byId = new Map(playerRows.map((p) => [p.id, { slug: p.slug, name: p.name }]));
  const resolve = (ids: number[]): PlayerRef[] =>
    ids.map((id) => byId.get(id)).filter((p): p is PlayerRef => p != null);

  // Set scores for all rubbers in one query; group preserving per-rubber order.
  const rubberIds = rubberRows.map((r) => r.id);
  const setRows = rubberIds.length
    ? await db
        .select()
        .from(schema.setScores)
        .where(inArray(schema.setScores.rubberId, rubberIds))
        .orderBy(schema.setScores.orderInRubber)
    : [];
  const setsByRubber = new Map<number, { home: number; away: number }[]>();
  for (const s of setRows) {
    const arr = setsByRubber.get(s.rubberId) ?? [];
    arr.push({ home: s.homeScore, away: s.awayScore });
    setsByRubber.set(s.rubberId, arr);
  }

  return {
    fixture: {
      id: fx.id,
      date: fx.date,
      division: { slug: fx.divSlug, name: fx.divName },
      homeTeam: { slug: fx.homeSlug, name: fx.homeName },
      awayTeam: { slug: fx.awaySlug, name: fx.awayName },
      ...(fx.homeScore != null && fx.awayScore != null ? { score: { home: fx.homeScore, away: fx.awayScore } } : {}),
    },
    rubbers: rubberRows.map((r) => ({
      orderInCard: r.orderInCard,
      homePlayers: resolve(r.homePlayerIds),
      awayPlayers: resolve(r.awayPlayerIds),
      sets: setsByRubber.get(r.id) ?? [],
    })),
  };
};
