import { pgTable, serial, integer, numeric, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { players } from './players.ts';
import { divisions } from './divisions.ts';

export const rankingMovement = pgEnum('ranking_movement', ['up', 'down', 'same', 'new']);

export const rankings = pgTable(
  'rankings',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id').notNull().references(() => players.id),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
    rank: integer('rank').notNull(),
    rubbersWon: numeric('rubbers_won').notNull(),         // numeric — half-points
    rubbersPlayed: numeric('rubbers_played').notNull(),
    gamesWon: integer('games_won').notNull(),
    gamesPlayed: integer('games_played').notNull(),
    rankingScore: numeric('ranking_score').notNull(),
    movement: rankingMovement('movement').notNull(),
  },
  (t) => ({
    playerDivisionIdx: uniqueIndex('rankings_player_division_idx').on(t.playerId, t.divisionId),
  }),
);
