import { eq } from 'drizzle-orm';
import type { Database } from '@ctl/db';
import { schema } from '@ctl/db';
import { slugify } from '@ctl/parser';

export const resolveClub = async (db: Database, observedName: string): Promise<number> => {
  const [existing] = await db
    .select({ clubId: schema.clubAliases.clubId })
    .from(schema.clubAliases)
    .where(eq(schema.clubAliases.observedName, observedName))
    .limit(1);
  if (existing) return existing.clubId;

  return db.transaction(async (tx) => {
    const slug = slugify(observedName);
    const [bySlug] = await tx.select().from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);
    let clubId: number;
    if (bySlug) {
      clubId = bySlug.id;
    } else {
      const [created] = await tx
        .insert(schema.clubs)
        .values({ slug, canonicalName: observedName, needsReview: true })
        .returning();
      clubId = created!.id;
    }
    await tx
      .insert(schema.clubAliases)
      .values({ clubId, observedName })
      .onConflictDoNothing();
    return clubId;
  });
};

export const resolvePlayer = async (db: Database, observedName: string, clubId: number): Promise<number> => {
  const [existing] = await db
    .select({ playerId: schema.playerAliases.playerId })
    .from(schema.playerAliases)
    .where(eq(schema.playerAliases.observedName, observedName))
    .limit(1);
  if (existing) return existing.playerId;

  return db.transaction(async (tx) => {
    const slug = slugify(observedName);
    const [bySlug] = await tx.select().from(schema.players).where(eq(schema.players.slug, slug)).limit(1);
    let playerId: number;
    if (bySlug) {
      playerId = bySlug.id;
    } else {
      const [created] = await tx
        .insert(schema.players)
        .values({ slug, name: observedName, clubId, needsReview: true })
        .returning();
      playerId = created!.id;
    }
    await tx
      .insert(schema.playerAliases)
      .values({ playerId, observedName })
      .onConflictDoNothing();
    return playerId;
  });
};

const TEAM_SUFFIX_REGEX = /^(.*\S)\s+[A-Z]$/;

export const stripTeamSuffix = (observedName: string): string => {
  const match = TEAM_SUFFIX_REGEX.exec(observedName);
  return match ? match[1]! : observedName;
};
