import { pgTable, serial, varchar, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { clubs } from './clubs.ts';

export const players = pgTable(
  'players',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    btmNumber: varchar('btm_number', { length: 16 }),
    clubId: integer('club_id').notNull().references(() => clubs.id),
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => ({
    slugIdx: uniqueIndex('players_slug_idx').on(t.slug),
  }),
);

export const playerAliases = pgTable(
  'player_aliases',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
    observedName: varchar('observed_name', { length: 128 }).notNull(),
  },
  (t) => ({
    nameIdx: uniqueIndex('player_aliases_name_idx').on(t.observedName),
  }),
);
