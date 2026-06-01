import { pgTable, serial, varchar, integer, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { seasons } from './seasons.ts';

export const divisionGroup = pgEnum('division_group', ['Mens', 'Ladies', 'Mixed']);

export const divisions = pgTable(
  'divisions',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    group: divisionGroup('group').notNull(),
    seasonId: integer('season_id').notNull().references(() => seasons.id),
    upstreamModeId: integer('upstream_mode_id').notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex('divisions_slug_season_idx').on(t.slug, t.seasonId),
    upstreamModeIdx: uniqueIndex('divisions_upstream_mode_id_season_idx').on(t.upstreamModeId, t.seasonId),
  }),
);
