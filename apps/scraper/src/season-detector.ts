import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import { parseSeasonNav } from '@ctl/parser';

export type SeasonDetectionResult = {
  currentSeasonId: number;
  currentSeasonName: string;
  totalSeasons: number;
};

export const detectAndPersistSeasons = async (
  db: Database,
  homeHtml: string,
): Promise<SeasonDetectionResult> => {
  const { seasons, current } = parseSeasonNav(homeHtml);

  return db.transaction(async (tx) => {
    await tx.update(schema.seasons).set({ current: false }).where(eq(schema.seasons.current, true));

    let currentSeasonId = 0;
    for (const s of seasons) {
      const [existing] = await tx
        .select()
        .from(schema.seasons)
        .where(eq(schema.seasons.slug, s.slug))
        .limit(1);
      const isCurrent = current?.slug === s.slug;
      if (existing) {
        if (isCurrent) {
          await tx.update(schema.seasons).set({ current: true }).where(eq(schema.seasons.id, existing.id));
          currentSeasonId = existing.id;
        }
      } else {
        const [created] = await tx
          .insert(schema.seasons)
          .values({ slug: s.slug, name: s.observedName, current: isCurrent })
          .returning();
        if (isCurrent) currentSeasonId = created!.id;
      }
    }

    return {
      currentSeasonId,
      currentSeasonName: current?.observedName ?? '',
      totalSeasons: seasons.length,
    };
  });
};
