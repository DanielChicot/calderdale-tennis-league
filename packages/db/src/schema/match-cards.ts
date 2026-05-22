import { pgTable, serial, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { fixtures } from './fixtures.ts';

export const matchCards = pgTable(
  'match_cards',
  {
    id: serial('id').primaryKey(),
    fixtureId: integer('fixture_id').notNull().references(() => fixtures.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    fixtureIdx: uniqueIndex('match_cards_fixture_idx').on(t.fixtureId),
  }),
);

export const rubbers = pgTable('rubbers', {
  id: serial('id').primaryKey(),
  matchCardId: integer('match_card_id').notNull().references(() => matchCards.id, { onDelete: 'cascade' }),
  orderInCard: integer('order_in_card').notNull(),
  homePlayerIds: integer('home_player_ids').array().notNull(),
  awayPlayerIds: integer('away_player_ids').array().notNull(),
});

export const setScores = pgTable('set_scores', {
  id: serial('id').primaryKey(),
  rubberId: integer('rubber_id').notNull().references(() => rubbers.id, { onDelete: 'cascade' }),
  orderInRubber: integer('order_in_rubber').notNull(),
  homeScore: integer('home_score').notNull(),     // integer — set scores are whole numbers
  awayScore: integer('away_score').notNull(),
});
