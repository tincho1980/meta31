import { z } from 'zod';
import { country, currency, id, text } from './common.js';

/** Property (RF-26): what rents, taxes, condo fees and utilities hang from. */
export const property = z.object({
  id,
  name: z.string(),
  country,
  /** Currency the property is thought in (rent, value). */
  currency,
  active: z.boolean(),
});
export type Property = z.infer<typeof property>;

export const propertyCreate = z.object({ name: text(80), country, currency });
export type PropertyCreate = z.infer<typeof propertyCreate>;

/** Properties are never deleted (masters): they are edited or deactivated. */
export const propertyUpdate = z
  .object({ name: text(80), country, currency, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });
export type PropertyUpdate = z.infer<typeof propertyUpdate>;
