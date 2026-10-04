import { z } from 'zod';
import { currency, id, isoDate, period, positiveAmount, text } from './common.js';

/** One-off income (RF-09): an extra, a project, a substitution, with its expected date. */
export const oneOffIncome = z.object({
  id,
  description: z.string(),
  categoryId: id,
  period,
  expectedDate: isoDate.nullable(),
  currency,
  estimatedAmount: z.string(),
  actualAmount: z.string().nullable(),
  status: z.enum(['expected', 'received', 'cancelled']),
});
export type OneOffIncome = z.infer<typeof oneOffIncome>;

const fields = {
  description: text(160),
  categoryId: id,
  period,
  expectedDate: isoDate.nullable(),
  currency,
  estimatedAmount: positiveAmount,
};

/** The expected date falls in the income's month. */
const dateInMonth = (v: { period?: string | undefined; expectedDate?: string | null | undefined }) =>
  !v.period || !v.expectedDate || v.expectedDate.slice(0, 7) === v.period.slice(0, 7);

export const oneOffIncomeCreate = z.object(fields).refine(dateInMonth, { message: 'month_mismatch', path: ['expectedDate'] });
export type OneOffIncomeCreate = z.infer<typeof oneOffIncomeCreate>;

export const oneOffIncomeUpdate = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine(dateInMonth, { message: 'month_mismatch', path: ['expectedDate'] });
export type OneOffIncomeUpdate = z.infer<typeof oneOffIncomeUpdate>;
