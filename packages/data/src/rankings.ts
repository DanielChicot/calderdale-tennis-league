import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type RankingRow = {
  rank: number;
  playerId: number;
  playerName: string;
  rubbersWon: string;
  rubbersPlayed: string;
  gamesWon: number;
  gamesPlayed: number;
  rankingScore: string;
  movement: 'up' | 'down' | 'same' | 'new';
};

export const getRankingsByDivision = async (db: Database, divisionId: number): Promise<RankingRow[]> => {
  return db
    .select({
      rank: schema.rankings.rank,
      playerId: schema.rankings.playerId,
      playerName: schema.players.name,
      rubbersWon: schema.rankings.rubbersWon,
      rubbersPlayed: schema.rankings.rubbersPlayed,
      gamesWon: schema.rankings.gamesWon,
      gamesPlayed: schema.rankings.gamesPlayed,
      rankingScore: schema.rankings.rankingScore,
      movement: schema.rankings.movement,
    })
    .from(schema.rankings)
    .innerJoin(schema.players, eq(schema.players.id, schema.rankings.playerId))
    .where(eq(schema.rankings.divisionId, divisionId))
    .orderBy(schema.rankings.rank);
};
