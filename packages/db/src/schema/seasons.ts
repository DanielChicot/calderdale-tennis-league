import { pgTable, serial, varchar, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const seasons = pgTable(
  'seasons',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    current: boolean('current').notNull().default(false),
  },
  (t) => ({
    slugIdx: uniqueIndex('seasons_slug_idx').on(t.slug),
  }),
);
