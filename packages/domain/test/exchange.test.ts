import { describe, expect, it } from 'vitest';
import { type ExchangeRate, MissingRateError, rateInEffect } from '../src/exchange.js';
import { toMoney } from '../src/money.js';

const usd = (validFrom: string, rate: string): ExchangeRate => ({ pair: 'USD_ARS', validFrom, rate: toMoney(rate) });

describe('exchange rate in force (rule 6)', () => {
  const rates = [usd('2026-09-01', '1400'), usd('2026-10-15', '1450'), { ...usd('2026-01-01', '40'), pair: 'UYU_USD' as const }];

  it('uses the latest rate whose start date is on or before the date', () => {
    expect(rateInEffect(rates, 'USD_ARS', '2026-09-01').toFixed(2)).toBe('1400.00');
    expect(rateInEffect(rates, 'USD_ARS', '2026-10-14').toFixed(2)).toBe('1400.00');
    expect(rateInEffect(rates, 'USD_ARS', '2026-10-15').toFixed(2)).toBe('1450.00');
    expect(rateInEffect(rates, 'USD_ARS', '2027-03-01').toFixed(2)).toBe('1450.00');
  });

  it('does not mix pairs', () => {
    expect(rateInEffect(rates, 'UYU_USD', '2026-10-15').toFixed(2)).toBe('40.00');
  });

  it('a backdated rate applies from its date even if loaded later', () => {
    const withBackdated = [...rates, usd('2026-10-01', '1420')];
    expect(rateInEffect(withBackdated, 'USD_ARS', '2026-09-30').toFixed(2)).toBe('1400.00');
    expect(rateInEffect(withBackdated, 'USD_ARS', '2026-10-05').toFixed(2)).toBe('1420.00');
    expect(rateInEffect(withBackdated, 'USD_ARS', '2026-10-20').toFixed(2)).toBe('1450.00');
  });

  it('without a rate before the date it reports what is missing', () => {
    expect(() => rateInEffect(rates, 'USD_ARS', '2026-08-31')).toThrow(MissingRateError);
    expect(() => rateInEffect([], 'UYU_USD', '2026-10-01')).toThrow(/UYU_USD.*2026-10-01/);
  });

  it('rejects malformed dates', () => {
    expect(() => rateInEffect(rates, 'USD_ARS', '2026-10')).toThrow(RangeError);
  });
});
