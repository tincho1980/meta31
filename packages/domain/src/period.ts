/**
 * A period is a month, represented as 'YYYY-MM-01' (D6).
 * Arithmetic is done with integers over (year, month), never with `Date`,
 * to avoid time zone shifts.
 */
export type Period = `${number}-${string}-01`;

export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])-01$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isPeriod(value: string): value is Period {
  return PERIOD_RE.test(value);
}

/** Validates and types a period. Throws unless it is 'YYYY-MM-01'. */
export function toPeriod(value: string): Period {
  if (!isPeriod(value)) throw new RangeError(`Invalid period: '${value}' (expected YYYY-MM-01)`);
  return value;
}

/** Period a 'YYYY-MM-DD' date (or a period) belongs to. */
export function periodOf(date: string): Period {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Invalid date: '${date}' (expected YYYY-MM-DD)`);
  return `${m[1]}-${m[2]}-01` as Period;
}

/**
 * Absolute month index: year × 12 + (month − 1). It is not bounded to 1–12:
 * October 2026 is 24321, so adding any number of months and converting back
 * rolls the year over naturally.
 */
function index(p: Period): number {
  const m = PERIOD_RE.exec(p);
  if (!m) throw new RangeError(`Invalid period: '${p}' (expected YYYY-MM-01)`);
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

function fromIndex(i: number): Period {
  const year = Math.floor(i / 12);
  const month = (i % 12) + 1;
  if (year < 1000 || year > 9999) throw new RangeError(`Year out of range: ${year}`);
  return `${year}-${String(month).padStart(2, '0')}-01` as Period;
}

/** Month of the year (1–12). */
export function monthOfYear(p: Period): number {
  return (index(p) % 12) + 1;
}

/** Adds (or subtracts, if n < 0) months to a period. */
export function addMonths(p: Period, n: number): Period {
  if (!Number.isInteger(n)) throw new RangeError(`Month count is not an integer: ${n}`);
  return fromIndex(index(p) + n);
}

/** Months from `from` to `to`: positive when `to` is later. */
export function monthsBetween(from: Period, to: Period): number {
  return index(to) - index(from);
}

/** Chronological order: negative if a < b, 0 if equal, positive if a > b. */
export function comparePeriods(a: Period, b: Period): number {
  return index(a) - index(b);
}

/** `count` consecutive periods starting at `from` inclusive (projection horizon). */
export function periodRange(from: Period, count: number): Period[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Invalid count: ${count}`);
  return Array.from({ length: count }, (_, i) => addMonths(from, i));
}

/** Today's date ('YYYY-MM-DD') in the Buenos Aires time zone. */
export function todayInBuenosAires(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Current month in Buenos Aires. */
export function currentPeriod(now: Date = new Date()): Period {
  return periodOf(todayInBuenosAires(now));
}
