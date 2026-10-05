import { z } from 'zod';
import { amount, currency, id, isoDate, period, positiveAmount, rate } from './common.js';

export const paymentMethod = z.enum(['transfer', 'debit', 'cash', 'mercado_pago', 'other']);

/** One payment of a commitment (RF-28). Its applied rate is fixed forever (rule 6). */
export const commitmentPayment = z.object({
  id,
  commitmentId: id,
  date: isoDate,
  paymentCurrency: currency,
  amountPaid: z.string(),
  appliedRate: z.string().nullable(),
  /** What it covers, in the commitment's currency. */
  allocatedAmount: z.string(),
  paymentMethod,
});
export type CommitmentPayment = z.infer<typeof commitmentPayment>;

/** A commitment with what is paid so far. */
export const commitmentDetail = z.object({
  id,
  description: z.string(),
  period: isoDate,
  currency,
  /** Actual if known, else estimated, plus surcharge. */
  amountInForce: z.string(),
  /** Sum of the allocated amounts. */
  paid: z.string(),
  status: z.enum(['pending', 'partially_paid', 'paid', 'cancelled']),
  /** Month it was born for (D5); different from `period` once postponed. */
  originPeriod: isoDate,
  estimatedAmount: z.string(),
  /** Real amount from the bill, statement or bank notice (rule 10); null while unknown. */
  actualAmount: z.string().nullable(),
  surcharge: z.string(),
  origin: z.enum(['credit_card', 'recurring_expense', 'one_off_expense', 'loan']),
  /**
   * Loans (RF-23): real − theoretical for the whole installment (all its parts, D5); null until
   * the real installment is known.
   */
  deviation: z.object({ amount: z.string(), percent: z.string() }).nullable(),
  /** The original of a split (D5): closed by what was paid; its rest lives in another row. */
  splitPart: z.boolean(),
  dueDate: isoDate.nullable(),
  cancellationReason: z.string().nullable(),
  payments: z.array(commitmentPayment),
});
export type CommitmentDetail = z.infer<typeof commitmentDetail>;

/**
 * Pay (in full or in part). `appliedRate` only when paying in another currency (pesos for a USD
 * commitment, rule 3); left out, the rate in force on the payment date is used.
 */
export const paymentCreate = z.object({
  date: isoDate,
  paymentCurrency: currency,
  amountPaid: positiveAmount,
  appliedRate: rate.refine((v) => /[1-9]/.test(v), { message: 'must_be_positive' }).nullable().optional(),
  paymentMethod,
});
export type PaymentCreate = z.infer<typeof paymentCreate>;

/** Mark an expected income as received, with the real amount (RF-08). */
export const incomeReceive = z.object({ receivedDate: isoDate, actualAmount: positiveAmount });
export type IncomeReceive = z.infer<typeof incomeReceive>;

export const incomeDetail = z.object({
  id,
  description: z.string(),
  currency,
  estimatedAmount: z.string(),
  actualAmount: z.string().nullable(),
  receivedDate: isoDate.nullable(),
  appliedRate: z.string().nullable(),
  status: z.enum(['expected', 'received', 'cancelled']),
});
export type IncomeDetail = z.infer<typeof incomeDetail>;

/**
 * Postpone to a date (D5): the commitment moves to that date's month ("lo pasaste al 15").
 * If part of it is paid, it splits: the original stays paid by what was paid and a child
 * with the rest is born in the new month.
 */
export const postponeInput = z.object({ dueDate: isoDate });
export type PostponeInput = z.infer<typeof postponeInput>;

/** Cancel with a reason (RF-28): it stops counting but is kept. */
export const cancelInput = z.object({ reason: z.string().trim().min(1, { message: 'required' }).max(200) });
export type CancelInput = z.infer<typeof cancelInput>;

/** What was cancelled in a month, to restore it if it was a mistake. */
export const cancelledLine = z.object({
  id,
  kind: z.enum(['commitment', 'income']),
  description: z.string(),
  currency,
  amount: z.string(),
  reason: z.string().nullable(),
});
export type CancelledLine = z.infer<typeof cancelledLine>;

/**
 * Real amount of a commitment (rule 10): it replaces the estimate. For a recurring expense,
 * `updateFollowing` also makes it the estimate from the next month on (RF-19).
 */
export const actualAmountInput = z.object({
  actualAmount: amount,
  updateFollowing: z.boolean().default(false),
});
export type ActualAmountInput = z.infer<typeof actualAmountInput>;

/**
 * Pay a card statement in its payment currency (RF-15, rule 3): the local part, and the USD part
 * paid in local currency with its rate (left out, the one in force on the date). At least one.
 */
export const cardPaymentInput = z
  .object({
    period,
    date: isoDate,
    paymentMethod,
    localAmount: positiveAmount.nullable().optional(),
    usdPartAmount: positiveAmount.nullable().optional(),
    appliedRate: rate.refine((v) => /[1-9]/.test(v), { message: 'must_be_positive' }).nullable().optional(),
  })
  .refine((v) => Boolean(v.localAmount || v.usdPartAmount), { message: 'required', path: ['localAmount'] });
export type CardPaymentInput = z.infer<typeof cardPaymentInput>;
