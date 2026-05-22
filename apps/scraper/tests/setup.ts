import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type Database } from '@ctl/db';

let container: StartedTestContainer | undefined;
let db: Database | undefined;

const POSTGRES_PORT = 5432;
const PG_USER = 'ctl';
const PG_PASSWORD = 'ctl';
const PG_DB = 'ctl';

export const startDb = async (): Promise<Database> => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_DB: PG_DB,
      POSTGRES_USER: PG_USER,
      POSTGRES_PASSWORD: PG_PASSWORD,
    })
    .withExposedPorts(POSTGRES_PORT)
    // Wait for Postgres to be ready. The "ready to accept connections" message
    // is logged twice on a fresh postgres:16-alpine: first by initdb on the
    // unix socket, then again by the real server on TCP after the bootstrap
    // restart. We need the second occurrence — the first races ahead of TCP
    // binding and yields ECONNRESET.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(POSTGRES_PORT);
  const user = encodeURIComponent(PG_USER);
  const pass = encodeURIComponent(PG_PASSWORD);
  const url = `postgres://${user}:${pass}@${host}:${port}/${PG_DB}`;
  db = createDb(url);
  await migrate(db, { migrationsFolder: 'packages/db/src/migrations' });
  return db;
};

export const stopDb = async (): Promise<void> => {
  await container?.stop();
};

export const getDb = (): Database => {
  if (!db) throw new Error('startDb() not called');
  return db;
};
