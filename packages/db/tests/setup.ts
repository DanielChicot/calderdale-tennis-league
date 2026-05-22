import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createDb, type Database } from '../src/client.js';

let container: StartedTestContainer | undefined;
let db: Database | undefined;

const POSTGRES_PORT = 5432;

export const startDb = async (): Promise<{ db: Database; url: string }> => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_DB: 'ctl',
      POSTGRES_USER: 'ctl',
      POSTGRES_PASSWORD: 'ctl',
    })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(POSTGRES_PORT);
  const url = `postgres://ctl:ctl@${host}:${port}/ctl`;
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
