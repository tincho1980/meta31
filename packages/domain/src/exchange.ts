import type { Money } from './money.js';

export type Currency = 'ARS' | 'USD' | 'UYU';
export type CurrencyPair = 'USD_ARS' | 'UYU_USD';

/** `exchange_rate` row. `validFrom` is 'YYYY-MM-DD' and may be earlier than the load date. */
export type ExchangeRate = { pair: CurrencyPair; validFrom: string; rate: Money };

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** No rate has been loaded with a start date on or before the requested date. */
export class MissingRateError extends Error {
  constructor(
    readonly pair: CurrencyPair,
    readonly date: string,
  ) {
    super(`No ${pair} exchange rate in force on ${date}`);
    this.name = 'MissingRateError';
  }
}

/**
 * Exchange rate in force on a date (rule 6): the pair's row with the greatest `validFrom ≤ date`.
 * It applies until another one is loaded. A backdated rate changes the result for dates
 * from its `validFrom` on; payments never go through here (they keep their `applied_rate`).
 * 'YYYY-MM-DD' dates are compared as text: lexicographic order is chronological order.
 */
export function rateInEffect(rates: readonly ExchangeRate[], pair: CurrencyPair, date: string): Money {
  if (!DATE_RE.test(date)) throw new RangeError(`Invalid date: '${date}' (expected YYYY-MM-DD)`);
  let best: ExchangeRate | null = null;
  for (const r of rates) {
    if (r.pair !== pair || r.validFrom > date) continue;
    if (best === null || r.validFrom > best.validFrom) best = r;
  }
  if (best === null) throw new MissingRateError(pair, date);
  return best.rate;
}

/*
 * Rate direction (decided 3/10): both pairs store how many units of the local
 * currency one dollar is worth, as quoted by banks and newspapers.
 *   USD_ARS = ARS per 1 USD (≈ 1450)
 *   UYU_USD = UYU per 1 USD (≈ 40)
 * Every conversion goes through USD, so UYU → ARS uses both rates (rule 5).
 */
const PAIR_FOR: Record<Exclude<Currency, 'USD'>, CurrencyPair> = { ARS: 'USD_ARS', UYU: 'UYU_USD' };

function toUsd(amount: Money, currency: Currency, rates: readonly ExchangeRate[], date: string): Money {
  if (currency === 'USD') return amount;
  return amount.dividedBy(rateInEffect(rates, PAIR_FOR[currency], date));
}

function fromUsd(usd: Money, currency: Currency, rates: readonly ExchangeRate[], date: string): Money {
  if (currency === 'USD') return usd;
  return usd.times(rateInEffect(rates, PAIR_FOR[currency], date));
}

/**
 * Converts an amount with the rates in force on `date` (rule 6). Only for display:
 * amounts are always stored in their original currency (rule 5) and payments use
 * their own `applied_rate`. Full precision: round only when displaying.
 */
export function convert(
  amount: Money,
  from: Currency,
  to: Currency,
  rates: readonly ExchangeRate[],
  date: string,
): Money {
  if (from === to) return amount;
  return fromUsd(toUsd(amount, from, rates, date), to, rates, date);
}

/** Totals are always shown in ARS and in USD (RF-03). */
export function toArsAndUsd(
  amount: Money,
  currency: Currency,
  rates: readonly ExchangeRate[],
  date: string,
): { ars: Money; usd: Money } {
  const usd = toUsd(amount, currency, rates, date);
  const ars = currency === 'ARS' ? amount : fromUsd(usd, 'ARS', rates, date);
  return { ars, usd };
}
