import type { Currency, CurrencyPair } from './exchange.js';
import { Money } from './money.js';

const cents = (x: Money) => x.toDecimalPlaces(2, Money.ROUND_HALF_UP);

/**
 * Pair whose rate converts between two currencies directly, or null if they are the same.
 * Both pairs are "local units per USD" (USD_ARS ≈ 1450, UYU_USD ≈ 40), so only conversions
 * against USD are direct; ARS ↔ UYU would need two rates and is not a payment we make.
 */
export function paymentPair(paid: Currency, owed: Currency): CurrencyPair | null {
  if (paid === owed) return null;
  const local = paid === 'USD' ? owed : owed === 'USD' ? paid : null;
  if (local === 'ARS') return 'USD_ARS';
  if (local === 'UYU') return 'UYU_USD';
  throw new RangeError(`No direct rate between ${paid} and ${owed}`);
}

/**
 * Amount a payment covers, in the commitment's currency (RF-15, rule 3, rule 6). `appliedRate`
 * is the rate actually used (local units per USD) and is stored with the payment: it never
 * changes afterwards, even if a backdated rate is loaded.
 *   USD owed, paid in pesos: pesos / rate · pesos owed, paid in USD: USD × rate.
 */
export function allocatePayment(amountPaid: Money, paid: Currency, owed: Currency, appliedRate: Money | null): Money {
  const pair = paymentPair(paid, owed);
  if (pair === null) return cents(amountPaid);
  if (appliedRate === null || appliedRate.lte(0)) throw new RangeError(`A payment in ${paid} of a ${owed} commitment needs its applied rate`);
  return cents(owed === 'USD' ? amountPaid.dividedBy(appliedRate) : amountPaid.times(appliedRate));
}

export type PaymentStatus = 'pending' | 'partially_paid' | 'paid';

/**
 * Status from what has been allocated against the amount in force (actual or estimated, plus
 * surcharge): covered → paid; something → partially paid; nothing → pending.
 */
export function paymentStatus(amountInForce: Money, allocated: readonly Money[]): PaymentStatus {
  const total = allocated.reduce((acc, a) => acc.plus(a), new Money(0));
  if (total.gte(amountInForce) && total.gt(0)) return 'paid';
  if (total.gt(0)) return 'partially_paid';
  return 'pending';
}
