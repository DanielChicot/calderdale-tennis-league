import { z } from 'zod';

export const RankingMovement = z.enum(['up', 'down', 'same', 'new']);
export type RankingMovement = z.infer<typeof RankingMovement>;

export const Ranking = z.object({
  playerId: z.number().int().positive(),
  divisionId: z.number().int().positive(),
  rank: z.number().int().positive(),
  rubbersWon: z.number().int().nonnegative(),
  rubbersPlayed: z.number().int().nonnegative(),
  gamesWon: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().nonnegative(),
  rankingScore: z.number(),
  movement: RankingMovement,
});
export type Ranking = z.infer<typeof Ranking>;
