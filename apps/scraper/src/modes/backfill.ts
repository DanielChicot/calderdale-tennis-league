import { createDb } from '@ctl/db';
import { createOrchestrator } from '../orchestrator.js';

export const runBackfill = async (): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  const orchestrator = createOrchestrator(db);
  const reports = await orchestrator.runBackfill();
  console.log(`[scraper] backfill complete (${reports.length} seasons):`, reports);
};
