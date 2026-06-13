import { error } from '@sveltejs/kit';
import { getMatchCard } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw error(404, 'Match not found');
  const card = await getMatchCard(getDb(), id);
  if (!card) throw error(404, 'Match card not found');
  return { card };
};
