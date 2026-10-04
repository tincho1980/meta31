import { addMonths, comparePeriods, monthOfYear, monthsBetween, type Period, periodOf } from './period.js';

/** Allowed values for `every_months` (database check). All of them divide 12. */
export const EVERY_MONTHS = [1, 2, 3, 6, 12] as const;
export type EveryMonths = (typeof EVERY_MONTHS)[number];

/** Periodicity of a rule (D7): every `everyMonths` months, aligned to `anchorMonth`. */
export type Periodicity = { everyMonths: number; anchorMonth: number };

/** Validity of a rule. 'YYYY-MM-DD' dates (or periods); `validTo` null = open-ended. */
export type Validity = { validFrom: string; validTo: string | null };

function assertPeriodicity({ everyMonths, anchorMonth }: Periodicity): void {
  if (!(EVERY_MONTHS as readonly number[]).includes(everyMonths)) {
    throw new RangeError(`Invalid every_months: ${everyMonths} (allowed: ${EVERY_MONTHS.join(', ')})`);
  }
  if (!Number.isInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 12) {
    throw new RangeError(`Invalid anchor_month: ${anchorMonth} (1–12)`);
  }
}

/**
 * Does the rule fall in this month? (D7, rule 8)
 * Monthly = 1/any anchor; bimonthly from February = 2/2 (Feb, Apr, Jun…);
 * yearly in March = 12/3 (a single commitment per year, in March).
 * Since every_months divides 12, the month of the year is enough: the pattern repeats every year.
 */
export function occursIn(rule: Periodicity, period: Period): boolean {
  assertPeriodicity(rule);
  const diff = monthOfYear(period) - rule.anchorMonth;
  return ((diff % rule.everyMonths) + rule.everyMonths) % rule.everyMonths === 0;
}

/**
 * Is the rule in force this month? (rule 11)
 * Compared by month, both ends inclusive: a rule with validFrom = 2026-03-15 applies
 * from March; with validTo = 2026-12-10 its last charge is in December.
 */
export function isActiveIn({ validFrom, validTo }: Validity, period: Period): boolean {
  if (comparePeriods(period, periodOf(validFrom)) < 0) return false;
  if (validTo !== null && comparePeriods(period, periodOf(validTo)) > 0) return false;
  return true;
}

/** Does the rule generate something this month? In force and due by its periodicity. */
export function generatesIn(rule: Periodicity & Validity, period: Period): boolean {
  return isActiveIn(rule, period) && occursIn(rule, period);
}

/** Period in which installment `n` (1 = first) falls, for something starting at `firstPeriod`. */
export function periodOfInstallment(firstPeriod: Period, n: number): Period {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Invalid installment number: ${n}`);
  return addMonths(firstPeriod, n - 1);
}

/**
 * Installment number (1…total) falling in `period`, or null if the month is before the
 * first or after the last one (rule 11: installments stop being projected on their own).
 * Used for card installment purchases, loans and one-off expenses paid in installments.
 */
export function installmentNumberIn(firstPeriod: Period, total: number, period: Period): number | null {
  if (!Number.isInteger(total) || total < 1) throw new RangeError(`Invalid installment total: ${total}`);
  const n = monthsBetween(firstPeriod, period) + 1;
  return n >= 1 && n <= total ? n : null;
}

/** Period of the last installment. */
export function lastInstallmentPeriod(firstPeriod: Period, total: number): Period {
  return periodOfInstallment(firstPeriod, total);
}
