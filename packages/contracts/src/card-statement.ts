import { z } from 'zod';
import { amount, id, isoDate, period } from './common.js';

/**
 * Real card statement with its totals (RF-11). Loading it replaces the estimate of that month
 * (RF-16, rule 10). Paid amount and financed balance are not stored: they come from payments (E2).
 */
export const cardStatement = z.object({
  id,
  creditCardId: id,
  /** Month in which it is due. */
  period,
  closingDate: isoDate,
  dueDate: isoDate,
  previousBalanceLocal: z.string(),
  previousBalanceUsd: z.string(),
  totalLocal: z.string(),
  totalUsd: z.string(),
  minimumPaymentLocal: z.string(),
});
export type CardStatement = z.infer<typeof cardStatement>;

const fields = {
  closingDate: isoDate,
  dueDate: isoDate,
  previousBalanceLocal: amount,
  previousBalanceUsd: amount,
  totalLocal: amount,
  totalUsd: amount,
  minimumPaymentLocal: amount,
};

/** It closes before it is due. */
const closesBeforeDue = (v: { closingDate?: string | undefined; dueDate?: string | undefined }) =>
  !v.closingDate || !v.dueDate || v.closingDate < v.dueDate;

/** The period is the month of the due date. */
export const cardStatementCreate = z
  .object({ creditCardId: id, ...fields })
  .refine(closesBeforeDue, { message: 'range', path: ['dueDate'] });
export type CardStatementCreate = z.infer<typeof cardStatementCreate>;

export const cardStatementUpdate = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine(closesBeforeDue, { message: 'range', path: ['dueDate'] });
export type CardStatementUpdate = z.infer<typeof cardStatementUpdate>;
