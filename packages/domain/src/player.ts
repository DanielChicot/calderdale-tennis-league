import { z } from 'zod';
import { BtmNumber, Slug } from './primitives.js';

export const Player = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  btmNumber: BtmNumber.optional(),
  clubId: z.number().int().positive(),
});
export type Player = z.infer<typeof Player>;
