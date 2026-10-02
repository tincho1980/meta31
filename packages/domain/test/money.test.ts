import { describe, expect, it } from 'vitest';
import { Money, moneyToDb, toMoney } from '../src/money.js';

describe('money', () => {
  it('opera sin errores de coma flotante', () => {
    expect(toMoney('0.1').plus(toMoney('0.2')).equals(toMoney('0.3'))).toBe(true);
  });

  it('redondea a 2 decimales con ROUND_HALF_UP al persistir', () => {
    expect(moneyToDb(toMoney('10.005'))).toBe('10.01');
    expect(moneyToDb(toMoney('10.004'))).toBe('10.00');
    expect(moneyToDb(toMoney('-10.005'))).toBe('-10.01');
  });

  it('mantiene precisión completa en cálculos intermedios', () => {
    const third = new Money('100').dividedBy(3);
    expect(moneyToDb(third.times(3))).toBe('100.00');
  });
});
