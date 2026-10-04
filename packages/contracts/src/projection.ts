import { z } from 'zod';
import { currency, id, isoDate, period } from './common.js';

/** Where a line comes from: the rule that generates it. */
export const lineOrigin = z.enum(['credit_card', 'recurring_expense', 'one_off_expense', 'loan', 'income_source', 'one_off_income']);

/** One income or commitment of a month: stored, or virtual (computed from the rules, D1). */
export const projectionLine = z.object({
  /** Stored row id; null for a virtual line. */
  id: id.nullable(),
  sourceKey: z.string().nullable(),
  origin: lineOrigin,
  originId: id.nullable(),
  description: z.string(),
  categoryId: id,
  date: isoDate.nullable(),
  currency,
  /** Amount in force: actual if known, else estimated (commitments include their surcharge). */
  amount: z.string(),
  /** False = still an estimate computed from the rules. */
  stored: z.boolean(),
  status: z.enum(['pending', 'partially_paid', 'paid', 'cancelled', 'expected', 'received']).nullable(),
  /** Derived (D5): born in an earlier month. */
  postponed: z.boolean(),
});
export type ProjectionLine = z.infer<typeof projectionLine>;

export const totals = z.object({ incomes: z.string(), commitments: z.string(), result: z.string() });
export type Totals = z.infer<typeof totals>;

/** Something that kept a line or a total out of the numbers, to show as a warning. */
export const projectionIssue = z.object({
  kind: z.enum(['missing_amount', 'missing_uva_value', 'missing_rate']),
  origin: z.string().optional(),
  id: z.string().optional(),
  pair: z.string().optional(),
  date: z.string().optional(),
  period,
});
export type ProjectionIssue = z.infer<typeof projectionIssue>;

/** A month of the projection (RF-30 estimated view, RF-31, RF-33). No carry-over (rule 9). */
export const monthProjection = z.object({
  period,
  incomes: z.array(projectionLine),
  commitments: z.array(projectionLine),
  /** Sums in each original currency. */
  byCurrency: z.record(currency, totals),
  /** Converted with the rate in force on each line's date (RF-03); null if a rate is missing. */
  ars: totals.nullable(),
  usd: totals.nullable(),
  /** Card + loan installments over the month's income, in ARS (RF-33). */
  installmentLoad: z.object({ amountArs: z.string(), percent: z.string().nullable() }).nullable(),
  issues: z.array(projectionIssue),
});
export type MonthProjection = z.infer<typeof monthProjection>;

export const projectionQuery = z.object({
  from: period.optional(),
  months: z.coerce.number().int().min(1).max(36).optional(),
});

/** Result of opening a month (D1): idempotent. */
export const openMonthResult = z.union([
  z.object({ status: z.literal('already_open') }),
  z.object({ status: z.literal('opened'), commitments: z.number(), incomes: z.number(), issues: z.array(projectionIssue) }),
]);
export type OpenMonthResult = z.infer<typeof openMonthResult>;
