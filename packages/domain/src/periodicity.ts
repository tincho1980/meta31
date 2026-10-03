import { addMonths, comparePeriods, monthOfYear, monthsBetween, type Period, periodOf } from './period.js';

/** Valores admitidos para `every_months` (check de la base). Todos dividen 12. */
export const EVERY_MONTHS = [1, 2, 3, 6, 12] as const;
export type EveryMonths = (typeof EVERY_MONTHS)[number];

/** Periodicidad de una regla (D7): cada `everyMonths` meses, alineada al `anchorMonth`. */
export type Periodicity = { everyMonths: number; anchorMonth: number };

/** Vigencia de una regla. Fechas 'YYYY-MM-DD' (o períodos); `validTo` null = indefinida. */
export type Validity = { validFrom: string; validTo: string | null };

function assertPeriodicity({ everyMonths, anchorMonth }: Periodicity): void {
  if (!(EVERY_MONTHS as readonly number[]).includes(everyMonths)) {
    throw new RangeError(`every_months inválido: ${everyMonths} (admitidos: ${EVERY_MONTHS.join(', ')})`);
  }
  if (!Number.isInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 12) {
    throw new RangeError(`anchor_month inválido: ${anchorMonth} (1–12)`);
  }
}

/**
 * ¿Toca la regla en este mes? (D7, regla 8)
 * Mensual = 1/cualquier ancla; bimestral desde febrero = 2/2 (feb, abr, jun…);
 * anual en marzo = 12/3 (un solo compromiso por año, en marzo).
 * Como every_months divide 12, alcanza con el mes del año: el patrón se repite igual todos los años.
 */
export function occursIn(rule: Periodicity, period: Period): boolean {
  assertPeriodicity(rule);
  const diff = monthOfYear(period) - rule.anchorMonth;
  return ((diff % rule.everyMonths) + rule.everyMonths) % rule.everyMonths === 0;
}

/**
 * ¿Está vigente la regla en este mes? (regla 11)
 * Se compara por mes, con los dos extremos inclusive: una regla con
 * validFrom = 2026-03-15 rige desde marzo; con validTo = 2026-12-10 rige hasta diciembre.
 */
export function isActiveIn({ validFrom, validTo }: Validity, period: Period): boolean {
  if (comparePeriods(period, periodOf(validFrom)) < 0) return false;
  if (validTo !== null && comparePeriods(period, periodOf(validTo)) > 0) return false;
  return true;
}

/** ¿Genera algo la regla en este mes? Vigente y le toca según su periodicidad. */
export function generatesIn(rule: Periodicity & Validity, period: Period): boolean {
  return isActiveIn(rule, period) && occursIn(rule, period);
}

/** Período en que cae la cuota `n` (1 = primera) de algo que arranca en `firstPeriod`. */
export function periodOfInstallment(firstPeriod: Period, n: number): Period {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Número de cuota inválido: ${n}`);
  return addMonths(firstPeriod, n - 1);
}

/**
 * Número de cuota (1…total) que cae en `period`, o null si el mes está antes de la
 * primera o después de la última (regla 11: las cuotas dejan de proyectarse solas).
 * Sirve para compras en cuotas, préstamos y gastos puntuales en cuotas.
 */
export function installmentNumberIn(firstPeriod: Period, total: number, period: Period): number | null {
  if (!Number.isInteger(total) || total < 1) throw new RangeError(`Total de cuotas inválido: ${total}`);
  const n = monthsBetween(firstPeriod, period) + 1;
  return n >= 1 && n <= total ? n : null;
}

/** Período de la última cuota. */
export function lastInstallmentPeriod(firstPeriod: Period, total: number): Period {
  return periodOfInstallment(firstPeriod, total);
}
