import { z } from 'zod';
import { currency, id, isoDate, period, positiveAmount, text } from './common.js';

/** Most installments accepted for a one-off expense paid outside the card. */
export const MAX_INSTALLMENTS = 120;

/**
 * One-off expense (RF-21): one payment or a few installments outside the card. The installment
 * amount and the last month are computed by the domain (total / installments, the last one
 * absorbs the rounding).
 */
export const oneOffExpense = z.object({
  id,
  description: z.string(),
  categoryId: id,
  propertyId: id.nullable(),
  currency,
  totalAmount: z.string(),
  installments: z.number(),
  firstPeriod: period,
  plannedDate: isoDate.nullable(),
  /** Regular installment; the last one may differ by the rounding. */
  installmentAmount: z.string(),
  lastPeriod: period,
});
export type OneOffExpense = z.infer<typeof oneOffExpense>;

const installments = z
  .number()
  .int({ message: 'installments' })
  .min(1, { message: 'installments' })
  .max(MAX_INSTALLMENTS, { message: 'installments' });

const fields = {
  description: text(160),
  categoryId: id,
  propertyId: id.nullable(),
  currency,
  totalAmount: positiveAmount,
  installments,
  firstPeriod: period,
  plannedDate: isoDate.nullable(),
};

/** The planned date is the date of the first payment, so it falls in the first month. */
const plannedInFirstMonth = (v: { firstPeriod?: string | undefined; plannedDate?: string | null | undefined }) =>
  !v.firstPeriod || !v.plannedDate || v.plannedDate.slice(0, 7) === v.firstPeriod.slice(0, 7);

export const oneOffExpenseCreate = z
  .object(fields)
  .refine(plannedInFirstMonth, { message: 'month_mismatch', path: ['plannedDate'] });
export type OneOffExpenseCreate = z.infer<typeof oneOffExpenseCreate>;

export const oneOffExpenseUpdate = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine(plannedInFirstMonth, { message: 'month_mismatch', path: ['plannedDate'] });
export type OneOffExpenseUpdate = z.infer<typeof oneOffExpenseUpdate>;
