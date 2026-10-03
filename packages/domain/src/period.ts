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

/** Number of days in the period's month (leap years included). */
export function daysInMonth(p: Period): number {
  const i = index(p);
  const year = Math.floor(i / 12);
  const month = (i % 12) + 1;
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Due date ('YYYY-MM-DD') for a day of the month within a period. A day beyond the
 * month's length falls on its last day: due day 31 is always the last day of the month.
 */
export function dateInPeriod(p: Period, day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`Invalid day of month: ${day}`);
  const d = Math.min(day, daysInMonth(p));
  return `${p.slice(0, 8)}${String(d).padStart(2, '0')}`;
}

/** Calendar days from `from` to `to` ('YYYY-MM-DD'), signed. Counted in UTC, so no DST shifts. */
export function daysBetween(from: string, to: string): number {
  const utc = (date: string) => {
    periodOf(date); // validates the format
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
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
