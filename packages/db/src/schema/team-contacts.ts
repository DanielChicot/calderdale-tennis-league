import { pgTable, serial, integer, varchar, index } from 'drizzle-orm/pg-core';
import { teams } from './teams.ts';

export const teamContacts = pgTable(
  'team_contacts',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    role: varchar('role', { length: 64 }),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 128 }),
  },
  (t) => ({
    teamIdx: index('team_contacts_team_id_idx').on(t.teamId),
  }),
);
