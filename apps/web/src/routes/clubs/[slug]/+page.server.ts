import { error } from '@sveltejs/kit';
import { getClubDetail } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const club = await getClubDetail(getDb(), params.slug);
  if (!club) throw error(404, 'Club not found');
  return { club };
};
