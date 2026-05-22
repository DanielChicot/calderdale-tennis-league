import { pgTable, serial, integer, date, pgEnum, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { teams } from './teams.ts';
import { divisions } from './divisions.ts';

export const fixtureStatus = pgEnum('fixture_status', [
  'scheduled',
  'completed',
  'postponed',
  'unfinished',
  'rearranged-postponed',
  'rearranged-unfinished',
  'rubbers-conceded',
  'match-conceded',
]);

export const fixtures = pgTable(
  'fixtures',
  {
    id: serial('id').primaryKey(),
    upstreamId: integer('upstream_id'),       // fixture_id from upstream, when known
    date: date('date').notNull(),
    homeTeamId: integer('home_team_id').notNull().references(() => teams.id),
    awayTeamId: integer('away_team_id').notNull().references(() => teams.id),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
    status: fixtureStatus('status').notNull(),
  },
  (t) => ({
    upstreamIdx: uniqueIndex('fixtures_upstream_idx').on(t.upstreamId),
  }),
);

export const results = pgTable('results', {
  fixtureId: integer('fixture_id').primaryKey().references(() => fixtures.id, { onDelete: 'cascade' }),
  homeScore: numeric('home_score').notNull(),     // numeric — half-points possible
  awayScore: numeric('away_score').notNull(),
});
