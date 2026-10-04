import { describe, expect, it } from 'vitest';
import { categoryCreate, categoryUpdate, exchangeRateCreate, fieldErrors } from '../src/index.js';

const errorsOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? {} : fieldErrors(result.error as Parameters<typeof fieldErrors>[0]);
};

describe('field codes shared by the Worker and the PWA', () => {
  it('classifies each kind of error with a stable code', () => {
    expect(errorsOf(categoryCreate, { name: '  ', kind: 'gift' })).toEqual({ name: 'required', kind: 'choice' });
    expect(errorsOf(categoryCreate, {})).toEqual({ name: 'required', kind: 'choice' }); // a missing option asks to choose one
    expect(errorsOf(exchangeRateCreate, { pair: 'USD_ARS', validFrom: '2026-02-30', rate: '1,5' })).toEqual({
      validFrom: 'date',
      rate: 'decimal',
    });
    expect(errorsOf(exchangeRateCreate, { pair: 'USD_ARS', validFrom: '2026-10-01', rate: '0.000' })).toEqual({
      rate: 'must_be_positive',
    });
    expect(errorsOf(categoryUpdate, {})).toEqual({ _: 'empty' });
  });

  it('accepts valid input and trims text', () => {
    expect(categoryCreate.parse({ name: ' Sueldos ', kind: 'income' })).toEqual({ name: 'Sueldos', kind: 'income' });
    expect(exchangeRateCreate.safeParse({ pair: 'UYU_USD', validFrom: '2026-10-01', rate: '40.25' }).success).toBe(true);
  });

  it('a rate must be a string: a JS number is rejected (RNF-10)', () => {
    expect(errorsOf(exchangeRateCreate, { pair: 'USD_ARS', validFrom: '2026-10-01', rate: 1450 })).toEqual({ rate: 'default' });
  });
});
