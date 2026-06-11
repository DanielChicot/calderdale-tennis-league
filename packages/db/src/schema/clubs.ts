import { sql } from 'drizzle-orm';
import { pgTable, serial, varchar, boolean, integer, numeric, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const clubs = pgTable(
  'clubs',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    canonicalName: varchar('canonical_name', { length: 128 }).notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
    upstreamClubId: integer('upstream_club_id'),   // from the my_club dropdown, when known
    address: text('address'),
    postcode: varchar('postcode', { length: 10 }),
    lat: numeric('lat'),
    lng: numeric('lng'),
  },
  (t) => ({
    slugIdx: uniqueIndex('clubs_slug_idx').on(t.slug),
    upstreamClubIdIdx: uniqueIndex('clubs_upstream_club_id_idx')
      .on(t.upstreamClubId)
      .where(sql`upstream_club_id IS NOT NULL`),
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
