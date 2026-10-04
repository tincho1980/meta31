import { z } from 'zod';
import { amountEntry, validToNotBefore } from './amount-history.js';
import { currency, dayOfMonth, everyMonths, id, monthOfYear, period, positiveAmount, text } from './common.js';

/** D2: utilities, taxes, condo fees, recurring payments outside cards and estimated budgets. */
export const expenseClass = z.enum(['utility', 'tax', 'condo_fee', 'recurring', 'budget']);

/** Recurring expense (RF-17, RF-18, RF-20), with its estimated amount history oldest first. */
export const recurringExpense = z.object({
  id,
  name: z.string(),
  class: expenseClass,
  provider: z.string().nullable(),
  categoryId: id,
  propertyId: id.nullable(),
  beneficiaryId: id.nullable(),
  currency,
  everyMonths: z.number(),
  anchorMonth: z.number(),
  dueDay: z.number().nullable(),
  validFrom: period,
  /** Last month it applies (inclusive); null = open-ended (rule 11). */
  validTo: period.nullable(),
  amounts: z.array(amountEntry),
});
export type RecurringExpense = z.infer<typeof recurringExpense>;

const fields = {
  name: text(120),
  class: expenseClass,
  provider: text(120).nullable(),
  categoryId: id,
  propertyId: id.nullable(),
  beneficiaryId: id.nullable(),
  currency,
  everyMonths,
  anchorMonth: monthOfYear,
  dueDay: dayOfMonth.nullable(),
  validFrom: period,
  validTo: period.nullable(),
};

/** New expense with its first estimated amount, in force from `validFrom`. */
export const recurringExpenseCreate = z
  .object({ ...fields, amount: positiveAmount })
  .refine(validToNotBefore, { message: 'range', path: ['validTo'] });
export type RecurringExpenseCreate = z.infer<typeof recurringExpenseCreate>;

/** Edit the expense; ending it = setting `validTo`. Amount changes go through the history. */
export const recurringExpenseUpdate = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine(validToNotBefore, { message: 'range', path: ['validTo'] });
export type RecurringExpenseUpdate = z.infer<typeof recurringExpenseUpdate>;
