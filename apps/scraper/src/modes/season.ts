import { createDb } from '@ctl/db';
import { createOrchestrator } from '../orchestrator.js';

export const runSeason = async (slug: string): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  try {
    const orchestrator = createOrchestrator(db);
    const report = await orchestrator.runSeason(slug);
    console.log(`[scraper] season ${slug} complete:`, report);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
};
