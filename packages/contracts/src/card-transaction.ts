import { z } from 'zod';
import { currency, id, isoDate, period, text } from './common.js';

export const cardTransactionKind = z.enum(['purchase', 'installment', 'subscription', 'interest', 'admin_fee', 'tax', 'payment', 'adjustment']);

/** Financial cost of a card (rule 4, report): interest + admin fees + taxes. */
export const FINANCIAL_COST_KINDS = ['interest', 'admin_fee', 'tax'] as const;

/** Amount that may be negative (payments and credits): numeric(14,2). */
const signedAmount = z
  .string()
  .trim()
  .min(1, { message: 'required' })
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, { message: 'decimal' });

/** One line of a real statement's breakdown (RF-12). */
export const cardTransaction = z.object({
  id,
  cardStatementId: id,
  kind: cardTransactionKind,
  date: isoDate.nullable(),
  description: z.string(),
  categoryId: id.nullable(),
  currency,
  amount: z.string(),
  installmentPurchaseId: id.nullable(),
  installmentNumber: z.number().nullable(),
  subscriptionId: id.nullable(),
});
export type CardTransaction = z.infer<typeof cardTransaction>;

export const cardTransactionCreate = z
  .object({
    kind: cardTransactionKind,
    date: isoDate.nullable(),
    description: text(160),
    categoryId: id.nullable(),
    currency,
    amount: signedAmount,
    installmentPurchaseId: id.nullable(),
    installmentNumber: z.number().int().min(1, { message: 'installments' }).nullable(),
    subscriptionId: id.nullable(),
  })
  .refine((v) => (v.installmentPurchaseId === null) === (v.installmentNumber === null), {
    message: 'required',
    path: ['installmentNumber'],
  });
export type CardTransactionCreate = z.infer<typeof cardTransactionCreate>;

/** Financial cost of one card in one statement month, per currency (report). */
export const financialCostRow = z.object({
  creditCardId: id,
  cardName: z.string(),
  period,
  currency,
  interest: z.string(),
  adminFee: z.string(),
  tax: z.string(),
  total: z.string(),
  /** `total` in ARS with the rate in force on the statement's due date; null if a rate is missing. */
  totalArs: z.string().nullable(),
});
export type FinancialCostRow = z.infer<typeof financialCostRow>;

export const financialCostQuery = z.object({ from: period.optional(), to: period.optional() });
