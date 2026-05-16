import { z } from 'zod';
import { Slug } from './primitives.js';

export const Season = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  current: z.boolean(),
});
export type Season = z.infer<typeof Season>;
