import { pgTable, integer, numeric, index } from 'drizzle-orm/pg-core';
import { teams } from './teams.ts';
import { divisions } from './divisions.ts';

export const standings = pgTable(
  'standings',
  {
    teamId: integer('team_id')
      .primaryKey()
      .references(() => teams.id, { onDelete: 'cascade' }),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
    position: integer('position').notNull(),
    resultsReceived: integer('results_received').notNull(),
    resultsTotal: integer('results_total').notNull(),
    pointsWon: numeric('points_won').notNull(),
    pointsLost: numeric('points_lost').notNull(),
  },
  (t) => ({
    divisionIdx: index('standings_division_id_idx').on(t.divisionId),
  }),
);
