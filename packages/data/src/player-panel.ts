import { aliasedTable, and, arrayContains, eq, gte, inArray, or } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type PanelRankingRow = {
  division: { slug: string; name: string };
  rank: number;
  movement: 'up' | 'down' | 'same' | 'new';
};

export type PlayerPanel = {
  player: { slug: string; name: string };
  club: { slug: string; name: string };
  // Most recent rubber that has recorded set scores; null when none exist.
  lastResult: {
    fixtureId: number;
    date: string;
    outcome: 'W' | 'L' | 'D';
    setsFor: number;
    setsAgainst: number;
    opponentTeam: { slug: string; name: string; divisionSlug: string };
  } | null;
  // W/L/D tally over all rubbers with recorded sets.
  seasonRecord: { wins: number; losses: number; draws: number };
  // Derived from the side of the most recent rubber; null when no rubbers.
  team: { slug: string; name: string; divisionSlug: string; position: number | null } | null;
  // Ranking for the derived team's division (falls back to first ranking).
  primaryRanking: PanelRankingRow | null;
  otherRankings: PanelRankingRow[];
  // Next scheduled fixture for the derived team on/after `today`.
  nextFixture: { fixtureId: number; date: string; home: boolean; opponent: { slug: string; name: string } } | null;
};

export const getPlayerPanel = async (db: Database, slug: string, today: string): Promise<PlayerPanel | null> => {
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

  const home = aliasedTable(schema.teams, 'home_team');
  const away = aliasedTable(schema.teams, 'away_team');
  const rubberRows = await db
    .select({
      rubberId: schema.rubbers.id,
      homeIds: schema.rubbers.homePlayerIds,
      fixtureId: schema.fixtures.id,
      date: schema.fixtures.date,
      divSlug: schema.divisions.slug,
      homeTeamId: home.id, homeTeamSlug: home.slug, homeTeamName: home.name,
      awayTeamId: away.id, awayTeamSlug: away.slug, awayTeamName: away.name,
    })
    .from(schema.rubbers)
    .innerJoin(schema.matchCards, eq(schema.matchCards.id, schema.rubbers.matchCardId))
    .innerJoin(schema.fixtures, eq(schema.fixtures.id, schema.matchCards.fixtureId))
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.fixtures.divisionId))
    .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
    .where(or(arrayContains(schema.rubbers.homePlayerIds, [player.id]), arrayContains(schema.rubbers.awayPlayerIds, [player.id])))
    .orderBy(schema.fixtures.date, schema.rubbers.id);

  const rubberIds = rubberRows.map((r) => r.rubberId);
  const setRows = rubberIds.length
    ? await db.select().from(schema.setScores).where(inArray(schema.setScores.rubberId, rubberIds)).orderBy(schema.setScores.orderInRubber)
    : [];
  const setsByRubber = new Map<number, { home: number; away: number }[]>();
  for (const s of setRows) {
    const arr = setsByRubber.get(s.rubberId) ?? [];
    arr.push({ home: s.homeScore, away: s.awayScore });
    setsByRubber.set(s.rubberId, arr);
  }

  const played = rubberRows.map((r) => {
    const onHome = r.homeIds.includes(player.id);
    const sets = setsByRubber.get(r.rubberId) ?? [];
    const setsFor = sets.filter((s) => (onHome ? s.home > s.away : s.away > s.home)).length;
    const setsAgainst = sets.length - setsFor;
    const outcome: 'W' | 'L' | 'D' = setsFor > setsAgainst ? 'W' : setsFor < setsAgainst ? 'L' : 'D';
    return {
      fixtureId: r.fixtureId,
      date: r.date,
      divSlug: r.divSlug,
      hasSets: sets.length > 0,
      setsFor,
      setsAgainst,
      outcome,
      myTeam: onHome
        ? { id: r.homeTeamId, slug: r.homeTeamSlug, name: r.homeTeamName }
        : { id: r.awayTeamId, slug: r.awayTeamSlug, name: r.awayTeamName },
      opponentTeam: onHome
        ? { slug: r.awayTeamSlug, name: r.awayTeamName }
        : { slug: r.homeTeamSlug, name: r.homeTeamName },
    };
  });

  const scored = played.filter((p) => p.hasSets);
  const seasonRecord = {
    wins: scored.filter((p) => p.outcome === 'W').length,
    losses: scored.filter((p) => p.outcome === 'L').length,
    draws: scored.filter((p) => p.outcome === 'D').length,
  };
  const latest = played.at(-1) ?? null;         // team derivation uses any rubber
  const latestScored = scored.at(-1) ?? null;   // headline result needs set scores

  const lastResult = latestScored
    ? {
        fixtureId: latestScored.fixtureId,
        date: latestScored.date,
        outcome: latestScored.outcome,
        setsFor: latestScored.setsFor,
        setsAgainst: latestScored.setsAgainst,
        opponentTeam: { ...latestScored.opponentTeam, divisionSlug: latestScored.divSlug },
      }
    : null;

  let team: PlayerPanel['team'] = null;
  let nextFixture: PlayerPanel['nextFixture'] = null;
  if (latest) {
    const [standing] = await db
      .select({ position: schema.standings.position })
      .from(schema.standings)
      .where(eq(schema.standings.teamId, latest.myTeam.id))
      .limit(1);
    team = { slug: latest.myTeam.slug, name: latest.myTeam.name, divisionSlug: latest.divSlug, position: standing?.position ?? null };

    const [next] = await db
      .select({
        id: schema.fixtures.id,
        date: schema.fixtures.date,
        homeTeamId: schema.fixtures.homeTeamId,
        homeSlug: home.slug, homeName: home.name,
        awaySlug: away.slug, awayName: away.name,
      })
      .from(schema.fixtures)
      .innerJoin(home, eq(home.id, schema.fixtures.homeTeamId))
      .innerJoin(away, eq(away.id, schema.fixtures.awayTeamId))
      .where(
        and(
          eq(schema.fixtures.status, 'scheduled'),
          gte(schema.fixtures.date, today),
          or(eq(schema.fixtures.homeTeamId, latest.myTeam.id), eq(schema.fixtures.awayTeamId, latest.myTeam.id)),
        ),
      )
      .orderBy(schema.fixtures.date)
      .limit(1);
    if (next) {
      const isHome = next.homeTeamId === latest.myTeam.id;
      nextFixture = {
        fixtureId: next.id,
        date: next.date,
        home: isHome,
        opponent: isHome ? { slug: next.awaySlug, name: next.awayName } : { slug: next.homeSlug, name: next.homeName },
      };
    }
  }

  const rankingRows = await db
    .select({
      divSlug: schema.divisions.slug,
      divName: schema.divisions.name,
      rank: schema.rankings.rank,
      movement: schema.rankings.movement,
    })
    .from(schema.rankings)
    .innerJoin(schema.divisions, eq(schema.divisions.id, schema.rankings.divisionId))
    .where(eq(schema.rankings.playerId, player.id))
    .orderBy(schema.divisions.name);
  const rankings: PanelRankingRow[] = rankingRows.map((r) => ({
    division: { slug: r.divSlug, name: r.divName },
    rank: r.rank,
    movement: r.movement,
  }));
  const primaryRanking = rankings.find((r) => r.division.slug === latest?.divSlug) ?? rankings[0] ?? null;
  const otherRankings = rankings.filter((r) => r !== primaryRanking);

  return {
    player: { slug: player.slug, name: player.name },
    club: { slug: player.clubSlug, name: player.clubName },
    lastResult,
    seasonRecord,
    team,
    primaryRanking,
    otherRankings,
    nextFixture,
  };
};
