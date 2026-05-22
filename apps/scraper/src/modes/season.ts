import { createDb } from '@ctl/db';
import { createOrchestrator } from '../orchestrator.js';

export const runSeason = async (slug: string): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  const orchestrator = createOrchestrator(db);
  const report = await orchestrator.runSeason(slug);
  console.log(`[scraper] season ${slug} complete:`, report);
};
