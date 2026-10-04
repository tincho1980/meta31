import { z } from 'zod';
import { currency, dayOfMonth, everyMonths, id, monthOfYear, period, positiveAmount, text } from './common.js';

/** One row of the amount history (rule 7): in force from `fromPeriod` until the next row. */
export const incomeSourceAmount = z.object({ id, fromPeriod: period, amount: z.string() });
export type IncomeSourceAmount = z.infer<typeof incomeSourceAmount>;

/** Income source (RF-07), with its amount history oldest first. */
export const incomeSource = z.object({
  id,
  name: z.string(),
  categoryId: id,
  holderId: id.nullable(),
  propertyId: id.nullable(),
  currency,
  everyMonths: z.number(),
  anchorMonth: z.number(),
  expectedDay: z.number().nullable(),
  validFrom: period,
  /** Last month it applies (inclusive); null = open-ended (rule 11). */
  validTo: period.nullable(),
  amounts: z.array(incomeSourceAmount),
});
export type IncomeSource = z.infer<typeof incomeSource>;

const fields = {
  name: text(120),
  categoryId: id,
  holderId: id.nullable(),
  propertyId: id.nullable(),
  currency,
  everyMonths,
  anchorMonth: monthOfYear,
  expectedDay: dayOfMonth.nullable(),
  validFrom: period,
  validTo: period.nullable(),
};

const validToNotBefore = (v: { validFrom?: string; validTo?: string | null }) =>
  !v.validFrom || !v.validTo || v.validTo >= v.validFrom;

/** New source with its first amount, in force from `validFrom`. */
export const incomeSourceCreate = z
  .object({ ...fields, amount: positiveAmount })
  .refine(validToNotBefore, { message: 'range', path: ['validTo'] });
export type IncomeSourceCreate = z.infer<typeof incomeSourceCreate>;

/** Edit the source; ending it = setting `validTo`. Amount changes go through the history. */
export const incomeSourceUpdate = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine(validToNotBefore, { message: 'range', path: ['validTo'] });
export type IncomeSourceUpdate = z.infer<typeof incomeSourceUpdate>;

/** New amount from a month on (a raise, a rent update). */
export const incomeSourceAmountCreate = z.object({ fromPeriod: period, amount: positiveAmount });
export type IncomeSourceAmountCreate = z.infer<typeof incomeSourceAmountCreate>;

export const incomeSourceAmountUpdate = z
  .object({ fromPeriod: period, amount: positiveAmount })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });
export type IncomeSourceAmountUpdate = z.infer<typeof incomeSourceAmountUpdate>;
