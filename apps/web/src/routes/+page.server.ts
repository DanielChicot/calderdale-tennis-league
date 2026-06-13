import { getCurrentSeason, listSeasons, listDivisions } from '@ctl/data';
import { getDb } from '$lib/server/db';
import { groupByDivisionGroup } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const currentSeason = await getCurrentSeason(db);
  const seasons = await listSeasons(db);
  const divisions = currentSeason ? await listDivisions(db, currentSeason.id) : [];
  return { currentSeason, seasons, groups: groupByDivisionGroup(divisions) };
};
