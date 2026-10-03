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
