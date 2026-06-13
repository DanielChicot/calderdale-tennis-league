import { createDb, type Database } from '@ctl/db';

let db: Database | undefined;

// Lazy singleton — the pool is created on first use, not at import, so unit
// tests that mock this module never open a connection.
export const getDb = (): Database => {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not set');
    db = createDb(url);
  }
  return db;
};
