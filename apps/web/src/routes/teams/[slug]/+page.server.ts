import { error } from '@sveltejs/kit';
import { getTeam } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const team = await getTeam(getDb(), params.slug);
  if (!team) throw error(404, 'Team not found');
  return { team };
};
