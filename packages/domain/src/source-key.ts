import type { Currency } from './exchange.js';
import type { Period } from './period.js';

/**
 * `source_key` formats (D1). A virtual candidate whose key is already stored is discarded,
 * wherever the stored row is now (postponed to another month, or cancelled).
 *   is:<id>:<period>             income source
 *   re:<id>:<period>             recurring expense
 *   cc:<id>:<period>:<currency>  credit card statement payment (one per currency, D4)
 *   oe:<id>:<n>                  one-off expense installment
 *   ln:<id>:<n>                  loan installment
 */
export const sourceKey = {
  incomeSource: (id: string, period: Period) => `is:${id}:${period}`,
  recurringExpense: (id: string, period: Period) => `re:${id}:${period}`,
  creditCard: (id: string, period: Period, currency: Currency) => `cc:${id}:${period}:${currency}`,
  oneOffExpense: (id: string, n: number) => `oe:${id}:${n}`,
  loan: (id: string, n: number) => `ln:${id}:${n}`,
};
