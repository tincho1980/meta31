import Decimal from 'decimal.js';

/**
 * Decimal configurado para dinero: precisión completa en los cálculos
 * intermedios y ROUND_HALF_UP al redondear. Nunca usar `number` para importes.
 */
export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = Decimal;

/** Convierte el string que devuelve Postgres (`numeric`) a Money. */
export function toMoney(value: string): Money {
  return new Money(value);
}

/** Redondea a 2 decimales (al persistir o mostrar) y devuelve el string para la base. */
export function moneyToDb(value: Money): string {
  return value.toDecimalPlaces(2, Money.ROUND_HALF_UP).toFixed(2);
}
