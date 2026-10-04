import { z } from 'zod';
import { amount, country, currency, dayOfMonth, id, text } from './common.js';

/**
 * Credit card (RF-10). The local currency follows the country and is also the payment
 * currency (rule 3): Argentine cards in ARS, the Uruguayan one in UYU, USD part included.
 */
export const creditCard = z.object({
  id,
  name: z.string(),
  bank: z.string(),
  country,
  holderId: id,
  localCurrency: currency,
  /** Approximate days; the real ones come with each statement. */
  closingDay: z.number(),
  dueDay: z.number(),
  /** Monthly spend outside installments and subscriptions, to estimate future statements (RF-16). */
  estimatedSpendLocal: z.string(),
  estimatedSpendUsd: z.string(),
  active: z.boolean(),
});
export type CreditCard = z.infer<typeof creditCard>;

const fields = {
  name: text(80),
  bank: text(80),
  country,
  holderId: id,
  closingDay: dayOfMonth,
  dueDay: dayOfMonth,
  estimatedSpendLocal: amount,
  estimatedSpendUsd: amount,
};

export const creditCardCreate = z.object(fields);
export type CreditCardCreate = z.infer<typeof creditCardCreate>;

/** Cards are never deleted (masters): they are edited or deactivated. */
export const creditCardUpdate = z
  .object({ ...fields, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });
export type CreditCardUpdate = z.infer<typeof creditCardUpdate>;

/** Rule 3: the payment currency of a card depends on its country. */
export const localCurrencyOf = (c: z.infer<typeof country>): 'ARS' | 'UYU' => (c === 'AR' ? 'ARS' : 'UYU');
