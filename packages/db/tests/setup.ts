import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createDb, type Database } from '../src/client.js';

let container: StartedTestContainer | undefined;
let db: Database | undefined;

const POSTGRES_PORT = 5432;
const PG_USER = 'ctl';
const PG_PASSWORD = 'ctl';
const PG_DB = 'ctl';

export const startDb = async (): Promise<{ db: Database; url: string }> => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_DB: PG_DB,
      POSTGRES_USER: PG_USER,
      POSTGRES_PASSWORD: PG_PASSWORD,
    })
    .withExposedPorts(POSTGRES_PORT)
    // Wait for the actual Postgres readiness log line, not just the TCP socket.
    // TCP can accept before initdb's bootstrap script finishes, which races
    // against subsequent migration tests.
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(POSTGRES_PORT);
  const user = encodeURIComponent(PG_USER);
  const pass = encodeURIComponent(PG_PASSWORD);
  const url = `postgres://${user}:${pass}@${host}:${port}/${PG_DB}`;
  db = createDb(url);
  return { db, url };
};

export const stopDb = async (): Promise<void> => {
  await container?.stop();
};

export const getDb = (): Database => {
  if (!db) throw new Error('startDb() not called');
  return db;
};
