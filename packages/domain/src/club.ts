import { z } from 'zod';
import { Slug } from './primitives.js';

export const Location = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().optional(),
  postcode: z.string().optional(),
});
export type Location = z.infer<typeof Location>;

export const Club = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1),
  location: Location.optional(),
});
export type Club = z.infer<typeof Club>;
