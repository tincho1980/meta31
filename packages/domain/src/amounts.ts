import type { Money } from './money.js';
import { comparePeriods, type Period, toPeriod } from './period.js';

/** Amount history row (`income_source_amount`, `recurring_expense_amount`). */
export type AmountFrom = { fromPeriod: string; amount: Money };

/**
 * Amount in force for a month (rule 7): the row with the greatest `fromPeriod ≤ period`.
 * It applies from its month until the next update. Null if the month is before the
 * first row (no amount loaded yet). The history may come in any order.
 */
export function amountInEffect(history: readonly AmountFrom[], period: Period): Money | null {
  let best: { fromPeriod: Period; amount: Money } | null = null;
  for (const row of history) {
    const from = toPeriod(row.fromPeriod);
    if (comparePeriods(from, period) > 0) continue;
    if (best === null || comparePeriods(from, best.fromPeriod) > 0) best = { fromPeriod: from, amount: row.amount };
  }
  return best?.amount ?? null;
}
