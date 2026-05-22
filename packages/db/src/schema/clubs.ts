import { pgTable, serial, varchar, boolean, integer, uniqueIndex } from 'drizzle-orm/pg-core';

export const clubs = pgTable(
  'clubs',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    canonicalName: varchar('canonical_name', { length: 128 }).notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => ({
    slugIdx: uniqueIndex('clubs_slug_idx').on(t.slug),
  }),
);

export const clubAliases = pgTable(
  'club_aliases',
  {
    id: serial('id').primaryKey(),
    clubId: integer('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    observedName: varchar('observed_name', { length: 128 }).notNull(),
  },
  (t) => ({
    nameIdx: uniqueIndex('club_aliases_name_idx').on(t.observedName),
  }),
);
