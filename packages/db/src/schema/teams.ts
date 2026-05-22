import { pgTable, serial, varchar, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { clubs } from './clubs.ts';
import { divisions } from './divisions.ts';

export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    clubId: integer('club_id').notNull().references(() => clubs.id),
    divisionId: integer('division_id').notNull().references(() => divisions.id),
  },
  (t) => ({
    slugDivisionIdx: uniqueIndex('teams_slug_division_idx').on(t.slug, t.divisionId),
  }),
);
