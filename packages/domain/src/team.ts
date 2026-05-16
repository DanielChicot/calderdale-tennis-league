import { z } from 'zod';
import { Slug } from './primitives.js';

export const Team = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  clubId: z.number().int().positive(),
  divisionId: z.number().int().positive(),
});
export type Team = z.infer<typeof Team>;
