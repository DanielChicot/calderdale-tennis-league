import { z } from 'zod';

export const SetScore = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});
export type SetScore = z.infer<typeof SetScore>;

export const Rubber = z.object({
  homePlayerIds: z.array(z.number().int().positive()).min(1).max(2),
  awayPlayerIds: z.array(z.number().int().positive()).min(1).max(2),
  sets: z.array(SetScore),
});
export type Rubber = z.infer<typeof Rubber>;

export const MatchCard = z.object({
  fixtureId: z.number().int().positive(),
  rubbers: z.array(Rubber),
});
export type MatchCard = z.infer<typeof MatchCard>;

export const Result = z.object({
  fixtureId: z.number().int().positive(),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  matchCard: MatchCard.optional(),
});
export type Result = z.infer<typeof Result>;
