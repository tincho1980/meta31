import { describe, expect, it } from 'vitest';
import { periodRange, toPeriod } from '../src/period.js';
import {
  generatesIn,
  installmentNumberIn,
  isActiveIn,
  lastInstallmentPeriod,
  occursIn,
  periodOfInstallment,
} from '../src/periodicity.js';

const p = (s: string) => toPeriod(s);
/** Months of 2026 in which the rule falls. */
const monthsIn2026 = (rule: { everyMonths: number; anchorMonth: number }) =>
  periodRange(p('2026-01-01'), 12)
    .filter((period) => occursIn(rule, period))
    .map((period) => Number(period.slice(5, 7)));

describe('periodicity (D7)', () => {
  it('monthly falls every month, regardless of the anchor', () => {
    expect(monthsIn2026({ everyMonths: 1, anchorMonth: 1 })).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(monthsIn2026({ everyMonths: 1, anchorMonth: 7 })).toHaveLength(12);
  });

  it('bimonthly from February (2/2) falls in even months', () => {
    expect(monthsIn2026({ everyMonths: 2, anchorMonth: 2 })).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('bimonthly with an odd anchor falls in odd months', () => {
    expect(monthsIn2026({ everyMonths: 2, anchorMonth: 1 })).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('quarterly and half-yearly align to the anchor even mid-year', () => {
    expect(monthsIn2026({ everyMonths: 3, anchorMonth: 11 })).toEqual([2, 5, 8, 11]);
    expect(monthsIn2026({ everyMonths: 6, anchorMonth: 8 })).toEqual([2, 8]);
  });

  it('the pattern repeats in later years', () => {
    const rule = { everyMonths: 3, anchorMonth: 2 };
    expect(occursIn(rule, p('2031-05-01'))).toBe(true);
    expect(occursIn(rule, p('2031-06-01'))).toBe(false);
  });

  it('rejects periodicities the database does not allow', () => {
    expect(() => occursIn({ everyMonths: 4, anchorMonth: 1 }, p('2026-01-01'))).toThrow(RangeError);
    expect(() => occursIn({ everyMonths: 1, anchorMonth: 13 }, p('2026-01-01'))).toThrow(RangeError);
    expect(() => occursIn({ everyMonths: 1, anchorMonth: 0 }, p('2026-01-01'))).toThrow(RangeError);
  });
});

describe('yearly tax (rule 8)', () => {
  it('yearly in March (12/3) generates a single commitment per year, in March', () => {
    expect(monthsIn2026({ everyMonths: 12, anchorMonth: 3 })).toEqual([3]);
    const inTwoYears = periodRange(p('2026-01-01'), 24).filter((period) =>
      occursIn({ everyMonths: 12, anchorMonth: 3 }, period),
    );
    expect(inTwoYears).toEqual(['2026-03-01', '2027-03-01']);
  });
});

describe('validity (rule 11)', () => {
  it('without an end date it applies indefinitely from its start', () => {
    const rule = { validFrom: '2026-10-01', validTo: null };
    expect(isActiveIn(rule, p('2026-09-01'))).toBe(false);
    expect(isActiveIn(rule, p('2026-10-01'))).toBe(true);
    expect(isActiveIn(rule, p('2040-01-01'))).toBe(true);
  });

  it('start and end months both count (inclusive)', () => {
    const rule = { validFrom: '2026-10-01', validTo: '2026-12-01' };
    expect(isActiveIn(rule, p('2026-10-01'))).toBe(true);
    expect(isActiveIn(rule, p('2026-12-01'))).toBe(true);
    expect(isActiveIn(rule, p('2027-01-01'))).toBe(false);
  });

  it('mid-month dates are compared by month: ending in December means a last charge in December', () => {
    const rule = { validFrom: '2026-03-15', validTo: '2026-12-10' };
    expect(isActiveIn(rule, p('2026-03-01'))).toBe(true);
    expect(isActiveIn(rule, p('2026-02-01'))).toBe(false);
    expect(isActiveIn(rule, p('2026-12-01'))).toBe(true);
    expect(isActiveIn(rule, p('2027-01-01'))).toBe(false);
  });

  it('a single-month rule applies only that month', () => {
    const rule = { validFrom: '2026-10-01', validTo: '2026-10-31' };
    expect(isActiveIn(rule, p('2026-10-01'))).toBe(true);
    expect(isActiveIn(rule, p('2026-09-01'))).toBe(false);
    expect(isActiveIn(rule, p('2026-11-01'))).toBe(false);
  });
});

describe('validity + periodicity', () => {
  it('a bimonthly rule that ends stops generating after its end even if due', () => {
    const rule = { everyMonths: 2, anchorMonth: 2, validFrom: '2026-01-01', validTo: '2026-07-31' };
    const generated = periodRange(p('2026-01-01'), 12).filter((period) => generatesIn(rule, period));
    expect(generated).toEqual(['2026-02-01', '2026-04-01', '2026-06-01']);
  });

  it('a yearly rule whose payment month is before its start begins the following year', () => {
    const rule = { everyMonths: 12, anchorMonth: 3, validFrom: '2026-05-01', validTo: null };
    const generated = periodRange(p('2026-01-01'), 24).filter((period) => generatesIn(rule, period));
    expect(generated).toEqual(['2027-03-01']);
  });
});

describe('installments (rule 11)', () => {
  const first = p('2026-07-01');

  it('places each installment in its month', () => {
    expect(periodOfInstallment(first, 1)).toBe('2026-07-01');
    expect(periodOfInstallment(first, 7)).toBe('2027-01-01');
    expect(lastInstallmentPeriod(first, 12)).toBe('2027-06-01');
    expect(() => periodOfInstallment(first, 0)).toThrow(RangeError);
  });

  it('returns the installment number of the month: "4 of 12" in October if it started in July', () => {
    expect(installmentNumberIn(first, 12, p('2026-10-01'))).toBe(4);
  });

  it('stops projecting after the last installment and does not project before the first', () => {
    expect(installmentNumberIn(first, 12, p('2027-06-01'))).toBe(12);
    expect(installmentNumberIn(first, 12, p('2027-07-01'))).toBeNull();
    expect(installmentNumberIn(first, 12, p('2026-06-01'))).toBeNull();
  });

  it('a single-installment purchase falls only in its month', () => {
    expect(installmentNumberIn(first, 1, first)).toBe(1);
    expect(installmentNumberIn(first, 1, p('2026-08-01'))).toBeNull();
  });

  it('installments ending within the 12-month horizon', () => {
    const horizon = periodRange(p('2026-10-01'), 12);
    const withInstallment = horizon.filter((period) => installmentNumberIn(first, 6, period) !== null);
    // 6 installments from July: Jul–Dec; within the Oct–Sep horizon only Oct, Nov, Dec remain
    expect(withInstallment).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });

  it('rejects an invalid installment total', () => {
    expect(() => installmentNumberIn(first, 0, first)).toThrow(RangeError);
  });
});
