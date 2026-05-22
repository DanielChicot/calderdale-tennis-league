import { createDb } from '@ctl/db';
import { createOrchestrator } from '../orchestrator.js';

export const runCurrent = async (): Promise<void> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const db = createDb(url);
  const orchestrator = createOrchestrator(db);
  const report = await orchestrator.runCurrent();
  console.log('[scraper] current mode complete:', report);
};
