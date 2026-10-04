import { z } from 'zod';
import { id, period, positiveAmount } from './common.js';

/**
 * One row of an amount history (rule 7, RF-19): in force from `fromPeriod` until the next row.
 * Shared by income sources and recurring expenses.
 */
export const amountEntry = z.object({ id, fromPeriod: period, amount: z.string() });
export type AmountEntry = z.infer<typeof amountEntry>;

/** New amount from a month on (a raise, a rent or a tariff update). */
export const amountEntryCreate = z.object({ fromPeriod: period, amount: positiveAmount });
export type AmountEntryCreate = z.infer<typeof amountEntryCreate>;

export const amountEntryUpdate = z
  .object({ fromPeriod: period, amount: positiveAmount })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });
export type AmountEntryUpdate = z.infer<typeof amountEntryUpdate>;

/** Validity check shared by rules with a start and an optional end month. */
export const validToNotBefore = (v: { validFrom?: string | undefined; validTo?: string | null | undefined }) =>
  !v.validFrom || !v.validTo || v.validTo >= v.validFrom;
