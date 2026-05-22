import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { startDb, stopDb, getDb } from './setup.js';
import { sql } from 'drizzle-orm';

describe('db connection', () => {
  beforeAll(async () => {
    await startDb();
  }, 120_000);

  afterAll(async () => {
    await stopDb();
  });

  it('can run SELECT 1', async () => {
    const db = getDb();
    const result = await db.execute(sql`SELECT 1 AS one`);
    expect(result[0]).toEqual({ one: 1 });
  });
});
