import { describe, expect, it } from 'vitest';
import {
  addMonths,
  comparePeriods,
  currentPeriod,
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
