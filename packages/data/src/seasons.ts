import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';

export type SeasonSummary = {
  id: number;
  slug: string;
  name: string;
  current: boolean;
};

export const getCurrentSeason = async (db: Database): Promise<SeasonSummary | null> => {
  const [row] = await db.select().from(schema.seasons).where(eq(schema.seasons.current, true)).limit(1);
  return row ?? null;
};

export const listSeasons = async (db: Database): Promise<SeasonSummary[]> => {
  return db.select().from(schema.seasons).orderBy(schema.seasons.id);
};
