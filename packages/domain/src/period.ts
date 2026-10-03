/**
 * Un período es un mes, representado como 'YYYY-MM-01' (D6).
 * Se opera con aritmética entera sobre (año, mes), nunca con `Date`,
 * para evitar corrimientos de zona horaria.
 */
export type Period = `${number}-${string}-01`;

export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])-01$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isPeriod(value: string): value is Period {
  return PERIOD_RE.test(value);
}

/** Valida y tipa un período. Lanza si no es 'YYYY-MM-01'. */
export function toPeriod(value: string): Period {
  if (!isPeriod(value)) throw new RangeError(`Período inválido: '${value}' (se espera YYYY-MM-01)`);
  return value;
}

/** Período al que pertenece una fecha 'YYYY-MM-DD' (o un período). */
export function periodOf(date: string): Period {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Fecha inválida: '${date}' (se espera YYYY-MM-DD)`);
  return `${m[1]}-${m[2]}-01` as Period;
}

/** Índice absoluto del mes: año × 12 + (mes − 1). Permite restar y comparar períodos. */
function index(p: Period): number {
  const m = PERIOD_RE.exec(p);
  if (!m) throw new RangeError(`Período inválido: '${p}' (se espera YYYY-MM-01)`);
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

function fromIndex(i: number): Period {
  const year = Math.floor(i / 12);
  const month = (i % 12) + 1;
  if (year < 1000 || year > 9999) throw new RangeError(`Año fuera de rango: ${year}`);
  return `${year}-${String(month).padStart(2, '0')}-01` as Period;
}

/** Mes del año (1–12). */
export function monthOfYear(p: Period): number {
  return (index(p) % 12) + 1;
}

/** Suma (o resta, si n < 0) meses a un período. */
export function addMonths(p: Period, n: number): Period {
  if (!Number.isInteger(n)) throw new RangeError(`Cantidad de meses no entera: ${n}`);
  return fromIndex(index(p) + n);
}

/** Meses de `from` a `to`: positivo si `to` es posterior. */
export function monthsBetween(from: Period, to: Period): number {
  return index(to) - index(from);
}

/** Orden cronológico: negativo si a < b, 0 si son iguales, positivo si a > b. */
export function comparePeriods(a: Period, b: Period): number {
  return index(a) - index(b);
}

/** `count` períodos consecutivos desde `from` inclusive (horizonte de la proyección). */
export function periodRange(from: Period, count: number): Period[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Cantidad inválida: ${count}`);
  return Array.from({ length: count }, (_, i) => addMonths(from, i));
}

/** Fecha de hoy ('YYYY-MM-DD') en la zona horaria de Buenos Aires. */
export function todayInBuenosAires(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Mes en curso en Buenos Aires. */
export function currentPeriod(now: Date = new Date()): Period {
  return periodOf(todayInBuenosAires(now));
}
