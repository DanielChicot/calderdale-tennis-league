import { z } from 'zod';
import { Slug } from './primitives.js';

export const DivisionGroup = z.enum(['Mixed', 'Mens', 'Ladies']);
export type DivisionGroup = z.infer<typeof DivisionGroup>;

export const Division = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  group: DivisionGroup,
  seasonId: z.number().int().positive(),
});
export type Division = z.infer<typeof Division>;
