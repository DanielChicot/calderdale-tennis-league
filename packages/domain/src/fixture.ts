import { z } from 'zod';
import { IsoDate } from './primitives.js';

export const FixtureStatus = z.enum([
  'scheduled',
  'completed',
  'postponed',
  'unfinished',
  'rearranged-postponed',
  'rearranged-unfinished',
  'rubbers-conceded',
  'match-conceded',
]);
export type FixtureStatus = z.infer<typeof FixtureStatus>;

export const Fixture = z.object({
  id: z.number().int().positive(),
  date: IsoDate,
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
  divisionId: z.number().int().positive(),
  status: FixtureStatus,
});
export type Fixture = z.infer<typeof Fixture>;
