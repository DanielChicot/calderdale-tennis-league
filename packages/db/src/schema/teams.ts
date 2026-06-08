import { sql } from 'drizzle-orm';
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
    upstreamTeamId: integer('upstream_team_id'),
  },
  (t) => ({
    slugDivisionIdx: uniqueIndex('teams_slug_division_idx').on(t.slug, t.divisionId),
    upstreamTeamIdIdx: uniqueIndex('teams_upstream_team_id_idx')
      .on(t.upstreamTeamId)
      .where(sql`upstream_team_id IS NOT NULL`),
  }),
);
