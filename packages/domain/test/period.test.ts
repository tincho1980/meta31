import { describe, expect, it } from 'vitest';
import {
  addMonths,
  comparePeriods,
  currentPeriod,
  dateInPeriod,
  daysBetween,
  daysInMonth,
  isPeriod,
  monthOfYear,
  monthsBetween,
  type Period,
  periodOf,
  periodRange,
  todayInBuenosAires,
  toPeriod,
} from '../src/period.js';

const p = (s: string) => toPeriod(s);

describe('period (D6)', () => {
  it('accepts only dates on day 1', () => {
    expect(isPeriod('2026-10-01')).toBe(true);
    expect(isPeriod('2026-10-15')).toBe(false);
    expect(isPeriod('2026-13-01')).toBe(false);
    expect(isPeriod('2026-00-01')).toBe(false);
    expect(isPeriod('26-10-01')).toBe(false);
    expect(() => toPeriod('2026-10-02')).toThrow(RangeError);
  });

  it('maps a date to its month', () => {
    expect(periodOf('2026-10-31')).toBe('2026-10-01');
    expect(periodOf('2026-02-01')).toBe('2026-02-01');
    expect(() => periodOf('2026-10-32')).toThrow(RangeError);
    expect(() => periodOf('2026/10/01')).toThrow(RangeError);
  });

  it('returns the month of the year', () => {
    expect(monthOfYear(p('2026-01-01'))).toBe(1);
    expect(monthOfYear(p('2026-12-01'))).toBe(12);
  });
});

describe('month arithmetic', () => {
  it('adds months within the year and across years', () => {
    expect(addMonths(p('2026-10-01'), 1)).toBe('2026-11-01');
    expect(addMonths(p('2026-10-01'), 3)).toBe('2027-01-01');
    expect(addMonths(p('2026-12-01'), 1)).toBe('2027-01-01');
    expect(addMonths(p('2026-01-01'), 24)).toBe('2028-01-01');
    expect(addMonths(p('2026-10-01'), 0)).toBe('2026-10-01');
  });

  it('adds more than 12 months without overflowing the month', () => {
    expect(addMonths(p('2026-10-01'), 15)).toBe('2028-01-01');
    expect(addMonths(p('2026-10-01'), 14)).toBe('2027-12-01');
    expect(addMonths(p('2026-01-01'), 120)).toBe('2036-01-01');
  });

  it('subtracts months across years', () => {
    expect(addMonths(p('2026-01-01'), -1)).toBe('2025-12-01');
    expect(addMonths(p('2026-03-01'), -14)).toBe('2025-01-01');
  });

  it('rejects non-integer counts', () => {
    expect(() => addMonths(p('2026-01-01'), 1.5)).toThrow(RangeError);
  });

  it('counts months between periods, signed', () => {
    expect(monthsBetween(p('2026-10-01'), p('2027-01-01'))).toBe(3);
    expect(monthsBetween(p('2027-01-01'), p('2026-10-01'))).toBe(-3);
    expect(monthsBetween(p('2026-10-01'), p('2026-10-01'))).toBe(0);
  });

  it('compares chronologically across years', () => {
    expect(comparePeriods(p('2026-12-01'), p('2027-01-01'))).toBeLessThan(0);
    expect(comparePeriods(p('2027-01-01'), p('2026-12-01'))).toBeGreaterThan(0);
    expect(comparePeriods(p('2026-05-01'), p('2026-05-01'))).toBe(0);
  });

  it('builds the projection horizon', () => {
    const range = periodRange(p('2026-11-01'), 3);
    expect(range).toEqual<Period[]>(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(periodRange(p('2026-10-01'), 12)).toHaveLength(12);
    expect(periodRange(p('2026-10-01'), 12).at(-1)).toBe('2027-09-01');
    expect(periodRange(p('2026-10-01'), 0)).toEqual([]);
  });
});

describe('days and due dates', () => {
  it('knows the length of each month, leap years included', () => {
    expect(daysInMonth(p('2026-02-01'))).toBe(28);
    expect(daysInMonth(p('2028-02-01'))).toBe(29);
    expect(daysInMonth(p('2100-02-01'))).toBe(28);
    expect(daysInMonth(p('2000-02-01'))).toBe(29);
    expect(daysInMonth(p('2026-04-01'))).toBe(30);
    expect(daysInMonth(p('2026-12-01'))).toBe(31);
  });

  it('a due day beyond the month length falls on its last day', () => {
    expect(dateInPeriod(p('2026-02-01'), 31)).toBe('2026-02-28');
    expect(dateInPeriod(p('2028-02-01'), 30)).toBe('2028-02-29');
    expect(dateInPeriod(p('2026-04-01'), 31)).toBe('2026-04-30');
    expect(dateInPeriod(p('2026-04-01'), 10)).toBe('2026-04-10');
    expect(() => dateInPeriod(p('2026-04-01'), 0)).toThrow(RangeError);
    expect(() => dateInPeriod(p('2026-04-01'), 32)).toThrow(RangeError);
  });

  it('counts calendar days between dates, across months and years', () => {
    expect(daysBetween('2026-03-10', '2026-04-30')).toBe(51);
    expect(daysBetween('2026-02-28', '2026-03-31')).toBe(31);
    expect(daysBetween('2026-12-31', '2027-01-31')).toBe(31);
    expect(daysBetween('2026-03-31', '2026-02-28')).toBe(-31);
    expect(() => daysBetween('2026-02-30x', '2026-03-01')).toThrow(RangeError);
  });
});

describe('today and current month', () => {
  it('computes today in Buenos Aires, not UTC', () => {
    // Nov 1 02:00 UTC = Oct 31 23:00 in Buenos Aires (UTC-3)
    const now = new Date('2026-11-01T02:00:00Z');
    expect(todayInBuenosAires(now)).toBe('2026-10-31');
    expect(currentPeriod(now)).toBe('2026-10-01');
  });

  it('the current month always has day 1', () => {
    expect(currentPeriod(new Date('2026-10-15T15:00:00Z'))).toBe('2026-10-01');
  });
});
