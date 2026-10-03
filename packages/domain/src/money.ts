import Decimal from 'decimal.js';

/**
 * Decimal configured for money: full precision in intermediate calculations
 * and ROUND_HALF_UP when rounding. Never use `number` for amounts.
 */
export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = Decimal;

/** Converts the string Postgres returns (`numeric`) to Money. */
export function toMoney(value: string): Money {
  return new Money(value);
}

/** Rounds to 2 decimals (when persisting or displaying) and returns the string for the database. */
export function moneyToDb(value: Money): string {
  return value.toDecimalPlaces(2, Money.ROUND_HALF_UP).toFixed(2);
}
