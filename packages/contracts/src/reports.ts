import { z } from 'zod';
import { currency, id, isoDate, period } from './common.js';
import { loan } from './loan.js';

/** Loans report: how many installments are left, when it ends, the debt and the deviation (RF-23, RF-25). */
export const loanReport = z.object({
  loan,
  /** Installments with a real amount loaded: real against theoretical. */
  deviations: z.array(
    z.object({ number: z.number(), dueDate: isoDate, theoretical: z.string(), actual: z.string(), amount: z.string(), percent: z.string() }),
  ),
  /** Sum of the deviations (what the bank charged above the schedule, e.g. late-payment interest). */
  deviationTotal: z.string(),
});
export type LoanReport = z.infer<typeof loanReport>;

/** Spending by category in a month (report): where the money goes. */
export const spendingByCategory = z.object({
  period,
  /** Sum of the month's commitments in ARS. */
  total: z.string(),
  rows: z.array(
    z.object({
      categoryId: id,
      amountArs: z.string(),
      lines: z.number(),
      /** Some line could not be converted (missing rate): the amount is a lower bound. */
      partial: z.boolean(),
    }),
  ),
});
export type SpendingByCategory = z.infer<typeof spendingByCategory>;

export const spendingQuery = z.object({ period: period.optional() });

/** Future commitments by type (report): installments, loans, subscriptions and one-off installments. */
export const futureCommitment = z.object({
  kind: z.enum(['installment_purchase', 'loan', 'subscription', 'one_off_expense']),
  id,
  description: z.string(),
  /** Card or lender. */
  detail: z.string().nullable(),
  currency,
  /** What it takes each month (the current installment for loans). */
  monthlyAmount: z.string(),
  /** Last month it applies; null = until it is cancelled (subscriptions). */
  lastPeriod: period.nullable(),
  /** Installments still to pay, counting the current month; null for subscriptions. */
  remaining: z.number().nullable(),
});
export type FutureCommitment = z.infer<typeof futureCommitment>;
