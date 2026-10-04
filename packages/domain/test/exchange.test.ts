import { describe, expect, it } from 'vitest';
import { convert, type ExchangeRate, MissingRateError, rateInEffect, toArsAndUsd } from '../src/exchange.js';
import { moneyToDb, toMoney } from '../src/money.js';

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

describe('conversion (rules 5 and 6)', () => {
  const uyu = (validFrom: string, rate: string): ExchangeRate => ({ pair: 'UYU_USD', validFrom, rate: toMoney(rate) });
  // USD_ARS = ARS per USD; UYU_USD = UYU per USD
  const rates = [usd('2026-10-01', '1450'), uyu('2026-10-01', '40'), usd('2026-11-01', '1500')];
  const m = (s: string) => toMoney(s);
  const show = (x: ReturnType<typeof toMoney>) => moneyToDb(x);

  it('the same currency needs no rate', () => {
    expect(show(convert(m('100'), 'UYU', 'UYU', [], '2026-10-10'))).toBe('100.00');
  });

  it('converts between ARS and USD with USD_ARS', () => {
    expect(show(convert(m('100'), 'USD', 'ARS', rates, '2026-10-10'))).toBe('145000.00');
    expect(show(convert(m('145000'), 'ARS', 'USD', rates, '2026-10-10'))).toBe('100.00');
  });

  it('converts UYU to USD with UYU_USD as pesos per dollar', () => {
    expect(show(convert(m('40000'), 'UYU', 'USD', rates, '2026-10-10'))).toBe('1000.00');
    expect(show(convert(m('1000'), 'USD', 'UYU', rates, '2026-10-10'))).toBe('40000.00');
  });

  it('converts UYU to ARS through USD', () => {
    // 40,000 UYU = 1,000 USD = 1,450,000 ARS
    expect(show(convert(m('40000'), 'UYU', 'ARS', rates, '2026-10-10'))).toBe('1450000.00');
    expect(show(convert(m('1450000'), 'ARS', 'UYU', rates, '2026-10-10'))).toBe('40000.00');
  });

  it('keeps full precision until display: a round trip does not lose cents', () => {
    const ars = convert(m('12345.67'), 'UYU', 'ARS', [usd('2026-10-01', '1437.25'), uyu('2026-10-01', '41.13')], '2026-10-10');
    const back = convert(ars, 'ARS', 'UYU', [usd('2026-10-01', '1437.25'), uyu('2026-10-01', '41.13')], '2026-10-10');
    expect(show(back)).toBe('12345.67');
  });

  it('uses the rate in force on the amount date', () => {
    expect(show(convert(m('100'), 'USD', 'ARS', rates, '2026-10-31'))).toBe('145000.00');
    expect(show(convert(m('100'), 'USD', 'ARS', rates, '2026-11-01'))).toBe('150000.00');
  });

  it('a backdated rate changes conversions from its date on (rule 6)', () => {
    const backdated = [...rates, usd('2026-10-15', '1470')];
    expect(show(convert(m('100'), 'USD', 'ARS', backdated, '2026-10-10'))).toBe('145000.00');
    expect(show(convert(m('100'), 'USD', 'ARS', backdated, '2026-10-20'))).toBe('147000.00');
  });

  it('reports which rate is missing', () => {
    expect(() => convert(m('1'), 'UYU', 'ARS', [usd('2026-10-01', '1450')], '2026-10-10')).toThrow(/UYU_USD/);
  });

  it('gives totals in ARS and USD for each currency (RF-03)', () => {
    const fromArs = toArsAndUsd(m('290000'), 'ARS', rates, '2026-10-10');
    expect([show(fromArs.ars), show(fromArs.usd)]).toEqual(['290000.00', '200.00']);
    const fromUsd = toArsAndUsd(m('200'), 'USD', rates, '2026-10-10');
    expect([show(fromUsd.ars), show(fromUsd.usd)]).toEqual(['290000.00', '200.00']);
    const fromUyu = toArsAndUsd(m('8000'), 'UYU', rates, '2026-10-10');
    expect([show(fromUyu.ars), show(fromUyu.usd)]).toEqual(['290000.00', '200.00']);
  });

  it('an ARS amount needs only USD_ARS, not the UYU rate', () => {
    const only = [usd('2026-10-01', '1450')];
    expect(show(toArsAndUsd(m('1450'), 'ARS', only, '2026-10-10').usd)).toBe('1.00');
  });
});
