import { z } from 'zod';
import { id, text } from './common.js';

export const categoryKind = z.enum(['income', 'expense']);

export const category = z.object({
  id,
  name: z.string(),
  kind: categoryKind,
  active: z.boolean(),
  /** System category (card payments): cannot be renamed or deactivated. */
  system: z.boolean(),
});
export type Category = z.infer<typeof category>;

export const categoryCreate = z.object({ name: text(80), kind: categoryKind });
export type CategoryCreate = z.infer<typeof categoryCreate>;

/** Categories are never deleted (masters): they are renamed or deactivated. */
export const categoryUpdate = z
  .object({ name: text(80), active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });
export type CategoryUpdate = z.infer<typeof categoryUpdate>;

export const categoryListQuery = z.object({ kind: categoryKind.optional() });
