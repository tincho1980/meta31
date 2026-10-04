import { z } from 'zod';
import { currency, id, isoDate, period, positiveAmount, text } from './common.js';
import { MAX_INSTALLMENTS } from './one-off-expense.js';

/**
 * Installment purchase on a card (RF-13): its installments are projected into the card's
 * statements until the last one. The currency is the card's local one or USD (D4).
 */
export const installmentPurchase = z.object({
  id,
  creditCardId: id,
  description: z.string(),
  categoryId: id,
  purchaseDate: isoDate,
  currency,
  installmentAmount: z.string(),
  installmentsTotal: z.number(),
  /** Statement where installment 1 falls. */
  firstPeriod: period,
  lastPeriod: period,
  /** Installment of the current month's statement; null before the first or after the last. */
  currentInstallment: z.number().nullable(),
});
export type InstallmentPurchase = z.infer<typeof installmentPurchase>;

const purchaseFields = {
  creditCardId: id,
  description: text(160),
  categoryId: id,
  purchaseDate: isoDate,
  currency,
  installmentAmount: positiveAmount,
  installmentsTotal: z
    .number()
    .int({ message: 'installments' })
    .min(1, { message: 'installments' })
    .max(MAX_INSTALLMENTS, { message: 'installments' }),
  firstPeriod: period,
};

export const installmentPurchaseCreate = z.object(purchaseFields);
export type InstallmentPurchaseCreate = z.infer<typeof installmentPurchaseCreate>;

export const installmentPurchaseUpdate = z
  .object(purchaseFields)
  .omit({ creditCardId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });
export type InstallmentPurchaseUpdate = z.infer<typeof installmentPurchaseUpdate>;

/**
 * Subscription or automatic debit on a card (RF-14): projected every month until it is
 * cancelled (`validTo`). The amount is updated from the latest statement.
 */
export const subscription = z.object({
  id,
  creditCardId: id,
  description: z.string(),
  categoryId: id,
  currency,
  amount: z.string(),
  validFrom: isoDate,
  /** Cancellation date; null = still active. */
  validTo: isoDate.nullable(),
});
export type Subscription = z.infer<typeof subscription>;

const subscriptionFields = {
  creditCardId: id,
  description: text(160),
  categoryId: id,
  currency,
  amount: positiveAmount,
  validFrom: isoDate,
  validTo: isoDate.nullable(),
};

const validToNotBefore = (v: { validFrom?: string | undefined; validTo?: string | null | undefined }) =>
  !v.validFrom || !v.validTo || v.validTo >= v.validFrom;

export const subscriptionCreate = z
  .object(subscriptionFields)
  .refine(validToNotBefore, { message: 'range', path: ['validTo'] });
export type SubscriptionCreate = z.infer<typeof subscriptionCreate>;

export const subscriptionUpdate = z
  .object(subscriptionFields)
  .omit({ creditCardId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine(validToNotBefore, { message: 'range', path: ['validTo'] });
export type SubscriptionUpdate = z.infer<typeof subscriptionUpdate>;

/** Optional filter of the lists: one card. */
export const cardItemListQuery = z.object({ creditCardId: id.optional() });
