import { z } from 'zod';
import { currency, id, isoDate, positiveAmount, rate } from './common.js';

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
