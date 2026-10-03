import { describe, expect, it } from 'vitest';
import { type AmountFrom, amountInEffect } from '../src/amounts.js';
import { toMoney } from '../src/money.js';
import { toPeriod } from '../src/period.js';

const p = (s: string) => toPeriod(s);
const row = (fromPeriod: string, amount: string): AmountFrom => ({ fromPeriod, amount: toMoney(amount) });

describe('amount in force (rule 7)', () => {
  const salary = [row('2026-03-01', '1500000'), row('2026-07-01', '1800000.50')];

  it('the amount stays until an update is loaded', () => {
    expect(amountInEffect(salary, p('2026-03-01'))?.toFixed(2)).toBe('1500000.00');
    expect(amountInEffect(salary, p('2026-06-01'))?.toFixed(2)).toBe('1500000.00');
  });

  it('the projection uses the new amount from its effective month', () => {
    expect(amountInEffect(salary, p('2026-07-01'))?.toFixed(2)).toBe('1800000.50');
    expect(amountInEffect(salary, p('2027-12-01'))?.toFixed(2)).toBe('1800000.50');
  });

  it('before the first loaded amount there is no amount', () => {
    expect(amountInEffect(salary, p('2026-02-01'))).toBeNull();
    expect(amountInEffect([], p('2026-02-01'))).toBeNull();
  });

  it('does not depend on history order', () => {
    const unordered = [row('2027-01-01', '300'), row('2026-01-01', '100'), row('2026-06-01', '200')];
    expect(amountInEffect(unordered, p('2026-05-01'))?.toFixed(2)).toBe('100.00');
    expect(amountInEffect(unordered, p('2026-12-01'))?.toFixed(2)).toBe('200.00');
    expect(amountInEffect(unordered, p('2027-01-01'))?.toFixed(2)).toBe('300.00');
  });

  it('rejects a from_period that is not day 1', () => {
    expect(() => amountInEffect([row('2026-03-15', '1')], p('2026-04-01'))).toThrow(RangeError);
  });
});
