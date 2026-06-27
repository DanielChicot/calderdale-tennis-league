import { getCurrentSeason, listSeasons, listDivisions, listClubs } from '@ctl/data';
import { getDb } from '$lib/server/db';
import { groupByDivisionGroup } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const currentSeason = await getCurrentSeason(db);
  const seasons = await listSeasons(db);
  const [divisions, clubs] = await Promise.all([
    currentSeason ? listDivisions(db, currentSeason.id) : Promise.resolve([]),
    listClubs(db),
  ]);
  const stats = { divisions: divisions.length, clubs: clubs.length, seasons: seasons.length };
  return { currentSeason, seasons, groups: groupByDivisionGroup(divisions), stats };
};
