import { z } from 'zod';

export const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
export type Slug = z.infer<typeof Slug>;

export const BtmNumber = z.string().regex(/^\d{4,8}$/);
export type BtmNumber = z.infer<typeof BtmNumber>;

export const IsoDate = z.string().date();
export type IsoDate = z.infer<typeof IsoDate>;
