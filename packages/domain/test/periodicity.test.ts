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
/** Meses de 2026 en los que toca la regla. */
const monthsIn2026 = (rule: { everyMonths: number; anchorMonth: number }) =>
  periodRange(p('2026-01-01'), 12)
    .filter((period) => occursIn(rule, period))
    .map((period) => Number(period.slice(5, 7)));

describe('periodicidad (D7)', () => {
  it('mensual toca todos los meses, sin importar el ancla', () => {
    expect(monthsIn2026({ everyMonths: 1, anchorMonth: 1 })).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(monthsIn2026({ everyMonths: 1, anchorMonth: 7 })).toHaveLength(12);
  });

  it('bimestral desde febrero (2/2) toca los meses pares', () => {
    expect(monthsIn2026({ everyMonths: 2, anchorMonth: 2 })).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('bimestral con ancla impar toca los impares', () => {
    expect(monthsIn2026({ everyMonths: 2, anchorMonth: 1 })).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('trimestral y semestral se alinean al ancla aunque esté a mitad de año', () => {
    expect(monthsIn2026({ everyMonths: 3, anchorMonth: 11 })).toEqual([2, 5, 8, 11]);
    expect(monthsIn2026({ everyMonths: 6, anchorMonth: 8 })).toEqual([2, 8]);
  });

  it('el patrón se repite igual en años siguientes', () => {
    const rule = { everyMonths: 3, anchorMonth: 2 };
    expect(occursIn(rule, p('2031-05-01'))).toBe(true);
    expect(occursIn(rule, p('2031-06-01'))).toBe(false);
  });

  it('rechaza periodicidades que la base no admite', () => {
    expect(() => occursIn({ everyMonths: 4, anchorMonth: 1 }, p('2026-01-01'))).toThrow(RangeError);
    expect(() => occursIn({ everyMonths: 1, anchorMonth: 13 }, p('2026-01-01'))).toThrow(RangeError);
    expect(() => occursIn({ everyMonths: 1, anchorMonth: 0 }, p('2026-01-01'))).toThrow(RangeError);
  });
});

describe('impuesto anual (regla 8)', () => {
  it('anual en marzo (12/3) genera un solo compromiso por año, en marzo', () => {
    expect(monthsIn2026({ everyMonths: 12, anchorMonth: 3 })).toEqual([3]);
    const inTwoYears = periodRange(p('2026-01-01'), 24).filter((period) =>
      occursIn({ everyMonths: 12, anchorMonth: 3 }, period),
    );
    expect(inTwoYears).toEqual(['2026-03-01', '2027-03-01']);
  });
});

describe('vigencia (regla 11)', () => {
  it('sin fecha de fin rige indefinidamente desde su inicio', () => {
    const rule = { validFrom: '2026-10-01', validTo: null };
    expect(isActiveIn(rule, p('2026-09-01'))).toBe(false);
    expect(isActiveIn(rule, p('2026-10-01'))).toBe(true);
    expect(isActiveIn(rule, p('2040-01-01'))).toBe(true);
  });

  it('el mes de inicio y el de fin cuentan (inclusive)', () => {
    const rule = { validFrom: '2026-10-01', validTo: '2026-12-01' };
    expect(isActiveIn(rule, p('2026-10-01'))).toBe(true);
    expect(isActiveIn(rule, p('2026-12-01'))).toBe(true);
    expect(isActiveIn(rule, p('2027-01-01'))).toBe(false);
  });

  it('con fechas a mitad de mes se compara por mes', () => {
    const rule = { validFrom: '2026-03-15', validTo: '2026-12-10' };
    expect(isActiveIn(rule, p('2026-03-01'))).toBe(true);
    expect(isActiveIn(rule, p('2026-02-01'))).toBe(false);
    expect(isActiveIn(rule, p('2026-12-01'))).toBe(true);
    expect(isActiveIn(rule, p('2027-01-01'))).toBe(false);
  });

  it('una regla de un solo mes rige solo ese mes', () => {
    const rule = { validFrom: '2026-10-01', validTo: '2026-10-31' };
    expect(isActiveIn(rule, p('2026-10-01'))).toBe(true);
    expect(isActiveIn(rule, p('2026-09-01'))).toBe(false);
    expect(isActiveIn(rule, p('2026-11-01'))).toBe(false);
  });
});

describe('vigencia + periodicidad', () => {
  it('un bimestral que termina deja de generar después de su fin aunque le toque', () => {
    const rule = { everyMonths: 2, anchorMonth: 2, validFrom: '2026-01-01', validTo: '2026-07-31' };
    const generated = periodRange(p('2026-01-01'), 12).filter((period) => generatesIn(rule, period));
    expect(generated).toEqual(['2026-02-01', '2026-04-01', '2026-06-01']);
  });

  it('un anual cuyo mes de pago cae antes del inicio de vigencia arranca el año siguiente', () => {
    const rule = { everyMonths: 12, anchorMonth: 3, validFrom: '2026-05-01', validTo: null };
    const generated = periodRange(p('2026-01-01'), 24).filter((period) => generatesIn(rule, period));
    expect(generated).toEqual(['2027-03-01']);
  });
});

describe('cuotas (regla 11)', () => {
  const first = p('2026-07-01');

  it('ubica cada cuota en su mes', () => {
    expect(periodOfInstallment(first, 1)).toBe('2026-07-01');
    expect(periodOfInstallment(first, 7)).toBe('2027-01-01');
    expect(lastInstallmentPeriod(first, 12)).toBe('2027-06-01');
    expect(() => periodOfInstallment(first, 0)).toThrow(RangeError);
  });

  it('devuelve el número de cuota del mes: "4 de 12" en octubre si arrancó en julio', () => {
    expect(installmentNumberIn(first, 12, p('2026-10-01'))).toBe(4);
  });

  it('deja de proyectar después de la última cuota y no proyecta antes de la primera', () => {
    expect(installmentNumberIn(first, 12, p('2027-06-01'))).toBe(12);
    expect(installmentNumberIn(first, 12, p('2027-07-01'))).toBeNull();
    expect(installmentNumberIn(first, 12, p('2026-06-01'))).toBeNull();
  });

  it('una compra en una sola cuota cae solo en su mes', () => {
    expect(installmentNumberIn(first, 1, first)).toBe(1);
    expect(installmentNumberIn(first, 1, p('2026-08-01'))).toBeNull();
  });

  it('cuotas que terminan dentro del horizonte de 12 meses', () => {
    const horizon = periodRange(p('2026-10-01'), 12);
    const withInstallment = horizon.filter((period) => installmentNumberIn(first, 6, period) !== null);
    // 6 cuotas desde julio: jul–dic; en el horizonte oct–sep solo quedan oct, nov, dic
    expect(withInstallment).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });

  it('rechaza un total de cuotas inválido', () => {
    expect(() => installmentNumberIn(first, 0, first)).toThrow(RangeError);
  });
});
