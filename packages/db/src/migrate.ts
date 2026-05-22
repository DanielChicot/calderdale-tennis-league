import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  await migrate(db, { migrationsFolder: './src/migrations' });
  console.log('migrations applied');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
