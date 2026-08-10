import { searchPlayers } from '@ctl/data';
import { getDb } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const results = q.length >= 2 ? await searchPlayers(getDb(), q) : [];
  return { q, results };
};
