import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDb>;

export const createDb = (databaseUrl: string) => {
  const sql = postgres(databaseUrl, { max: 5 });
  return drizzle(sql, { schema });
};
