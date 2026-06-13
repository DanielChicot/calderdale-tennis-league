import { arrayContains, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import type { PlayerRef } from './match-cards.js';
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

export type PlayerRankingRow = {
  division: { slug: string; name: string };
  rank: number;
  rankingScore: string;
  rubbersWon: string;
  rubbersPlayed: string;
};

export type MatchHistoryRow = {
  fixtureId: number;
  date: string;
  division: { slug: string; name: string };
  partners: PlayerRef[];
  opponents: PlayerRef[];
  sets: { home: number; away: number }[];
};

export type PlayerProfile = {
  player: { slug: string; name: string };
  club: { slug: string; name: string };
  rankings: PlayerRankingRow[];
  matchHistory: MatchHistoryRow[];
};

export const getPlayerProfile = async (db: Database, slug: string): Promise<PlayerProfile | null> => {
  const [player] = await db
    .select({
      id: schema.players.id,
      slug: schema.players.slug,
      name: schema.players.name,
      clubSlug: schema.clubs.slug,
      clubName: schema.clubs.canonicalName,
    })
    .from(schema.players)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.players.clubId))
    .where(eq(schema.players.slug, slug))
    .limit(1);
  if (!player) return null;

  const rankingRows = await db
    .select({
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
      rank: schema.rankings.rank,
      rankingScore: schema.rankings.rankingScore,
      rubbersWon: schema.rankings.rubbersWon,
      rubbersPlayed: schema.rankings.rubbersPlayed,
    })
    .from(schema.rankings)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.rankings.divisionId))
    .where(eq(schema.rankings.playerId, player.id))
    .orderBy(schema.divisions.name);
  const rankings: PlayerRankingRow[] = rankingRows.map((r) => ({
    division: { slug: r.divSlug, name: r.divName },
    rank: r.rank,
    rankingScore: r.rankingScore,
    rubbersWon: r.rubbersWon,
    rubbersPlayed: r.rubbersPlayed,
  }));

  // Rubbers the player appeared in (either side).
  const rubberRows = await db
    .select({
      rubberId: schema.rubbers.id,
      homeIds: schema.rubbers.homePlayerIds,
      awayIds: schema.rubbers.awayPlayerIds,
      fixtureId: schema.fixtures.id,
      date: schema.fixtures.date,
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
    })
    .from(schema.rubbers)
    .innerJoin(schema.matchCards, eq(schema.matchCards.id, schema.rubbers.matchCardId))
    .innerJoin(schema.fixtures, eq(schema.fixtures.id, schema.matchCards.fixtureId))
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
    .where(or(arrayContains(schema.rubbers.homePlayerIds, [player.id]), arrayContains(schema.rubbers.awayPlayerIds, [player.id])))
    .orderBy(schema.fixtures.date);

  // Resolve all partner/opponent names in one query.
  const otherIds = [
    ...new Set(
      rubberRows.flatMap((r) => [...r.homeIds, ...r.awayIds]).filter((id) => id !== player.id),
    ),
  ];
  const otherRows = otherIds.length
    ? await db
        .select({ id: schema.players.id, slug: schema.players.slug, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.id, otherIds))
    : [];
  const byId = new Map(otherRows.map((p) => [p.id, { slug: p.slug, name: p.name }]));
  const refs = (ids: number[]): PlayerRef[] =>
    ids.map((id) => byId.get(id)).filter((p): p is PlayerRef => p != null);

  // Set scores for the matched rubbers, grouped per rubber in order.
  const rubberIds = rubberRows.map((r) => r.rubberId);
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

  const matchHistory: MatchHistoryRow[] = rubberRows.map((r) => {
    const onHome = r.homeIds.includes(player.id);
    const sameSide = onHome ? r.homeIds : r.awayIds;
    const otherSide = onHome ? r.awayIds : r.homeIds;
    return {
      fixtureId: r.fixtureId,
      date: r.date,
      division: { slug: r.divSlug, name: r.divName },
      partners: refs(sameSide.filter((id) => id !== player.id)),
      opponents: refs(otherSide),
      sets: setsByRubber.get(r.rubberId) ?? [],
    };
  });

  return {
    player: { slug: player.slug, name: player.name },
    club: { slug: player.clubSlug, name: player.clubName },
    rankings,
    matchHistory,
  };
};
