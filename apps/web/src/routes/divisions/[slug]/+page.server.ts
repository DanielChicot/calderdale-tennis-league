import { error } from '@sveltejs/kit';
import { getDivisionTable, listFixturesByDivision, getRankingsByDivision } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const db = getDb();
  const table = await getDivisionTable(db, params.slug);
  if (!table) throw error(404, 'Division not found');
  const [fixtures, rankings] = await Promise.all([
    listFixturesByDivision(db, table.division.id),
    getRankingsByDivision(db, table.division.id),
  ]);
  return { table, fixtures, rankings };
};
