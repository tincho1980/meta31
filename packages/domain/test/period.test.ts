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

describe('período (D6)', () => {
  it('acepta solo fechas con día 1', () => {
    expect(isPeriod('2026-10-01')).toBe(true);
    expect(isPeriod('2026-10-15')).toBe(false);
    expect(isPeriod('2026-13-01')).toBe(false);
    expect(isPeriod('2026-00-01')).toBe(false);
    expect(isPeriod('26-10-01')).toBe(false);
    expect(() => toPeriod('2026-10-02')).toThrow(RangeError);
  });

  it('lleva una fecha a su mes', () => {
    expect(periodOf('2026-10-31')).toBe('2026-10-01');
    expect(periodOf('2026-02-01')).toBe('2026-02-01');
    expect(() => periodOf('2026-10-32')).toThrow(RangeError);
    expect(() => periodOf('2026/10/01')).toThrow(RangeError);
  });

  it('devuelve el mes del año', () => {
    expect(monthOfYear(p('2026-01-01'))).toBe(1);
    expect(monthOfYear(p('2026-12-01'))).toBe(12);
  });
});

describe('aritmética de meses', () => {
  it('suma meses dentro del año y cruzando años', () => {
    expect(addMonths(p('2026-10-01'), 1)).toBe('2026-11-01');
    expect(addMonths(p('2026-10-01'), 3)).toBe('2027-01-01');
    expect(addMonths(p('2026-12-01'), 1)).toBe('2027-01-01');
    expect(addMonths(p('2026-01-01'), 24)).toBe('2028-01-01');
    expect(addMonths(p('2026-10-01'), 0)).toBe('2026-10-01');
  });

  it('resta meses cruzando años', () => {
    expect(addMonths(p('2026-01-01'), -1)).toBe('2025-12-01');
    expect(addMonths(p('2026-03-01'), -14)).toBe('2025-01-01');
  });

  it('rechaza cantidades no enteras', () => {
    expect(() => addMonths(p('2026-01-01'), 1.5)).toThrow(RangeError);
  });

  it('cuenta meses entre períodos, con signo', () => {
    expect(monthsBetween(p('2026-10-01'), p('2027-01-01'))).toBe(3);
    expect(monthsBetween(p('2027-01-01'), p('2026-10-01'))).toBe(-3);
    expect(monthsBetween(p('2026-10-01'), p('2026-10-01'))).toBe(0);
  });

  it('compara cronológicamente aunque cambie el año', () => {
    expect(comparePeriods(p('2026-12-01'), p('2027-01-01'))).toBeLessThan(0);
    expect(comparePeriods(p('2027-01-01'), p('2026-12-01'))).toBeGreaterThan(0);
    expect(comparePeriods(p('2026-05-01'), p('2026-05-01'))).toBe(0);
  });

  it('arma el horizonte de la proyección', () => {
    const range = periodRange(p('2026-11-01'), 3);
    expect(range).toEqual<Period[]>(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(periodRange(p('2026-10-01'), 12)).toHaveLength(12);
    expect(periodRange(p('2026-10-01'), 12).at(-1)).toBe('2027-09-01');
    expect(periodRange(p('2026-10-01'), 0)).toEqual([]);
  });
});

describe('hoy y mes en curso', () => {
  it('calcula hoy en Buenos Aires, no en UTC', () => {
    // 1/11 02:00 UTC = 31/10 23:00 en Buenos Aires (UTC-3)
    const now = new Date('2026-11-01T02:00:00Z');
    expect(todayInBuenosAires(now)).toBe('2026-10-31');
    expect(currentPeriod(now)).toBe('2026-10-01');
  });

  it('el mes en curso siempre tiene día 1', () => {
    expect(currentPeriod(new Date('2026-10-15T15:00:00Z'))).toBe('2026-10-01');
  });
});
