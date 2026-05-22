import { pgTable, varchar, timestamp, boolean, integer, text } from 'drizzle-orm/pg-core';

export const scrapeRuns = pgTable('scrape_runs', {
  url: varchar('url', { length: 512 }).primaryKey(),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull(),
  lastModified: varchar('last_modified', { length: 64 }),       // HTTP Last-Modified header verbatim
  contentHash: varchar('content_hash', { length: 64 }),         // SHA-256 hex
  lastStatus: integer('last_status').notNull(),
  lastParseOk: boolean('last_parse_ok').notNull(),
  lastError: text('last_error'),
});
