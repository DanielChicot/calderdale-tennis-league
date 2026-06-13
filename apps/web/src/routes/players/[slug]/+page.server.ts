import { error } from '@sveltejs/kit';
import { getPlayerProfile } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const profile = await getPlayerProfile(getDb(), params.slug);
  if (!profile) throw error(404, 'Player not found');
  return { profile };
};
