import { describe, expect, it } from 'vitest';
import { Money, moneyToDb, toMoney } from '../src/money.js';

describe('money', () => {
  it('operates without floating point errors', () => {
    expect(toMoney('0.1').plus(toMoney('0.2')).equals(toMoney('0.3'))).toBe(true);
  });

  it('rounds to 2 decimals with ROUND_HALF_UP when persisting', () => {
    expect(moneyToDb(toMoney('10.005'))).toBe('10.01');
    expect(moneyToDb(toMoney('10.004'))).toBe('10.00');
    expect(moneyToDb(toMoney('-10.005'))).toBe('-10.01');
  });

  it('keeps full precision in intermediate calculations', () => {
    const third = new Money('100').dividedBy(3);
    expect(moneyToDb(third.times(3))).toBe('100.00');
  });
});
