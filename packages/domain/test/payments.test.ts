import { describe, expect, it } from 'vitest';
import { toMoney } from '../src/money.js';
import { allocatePayment, paymentPair, paymentStatus } from '../src/payments.js';

const m = (s: string) => toMoney(s);
const alloc = (paid: string, from: 'ARS' | 'USD' | 'UYU', to: 'ARS' | 'USD' | 'UYU', rate: string | null) =>
  allocatePayment(m(paid), from, to, rate === null ? null : m(rate)).toFixed(2);

describe('payment allocation (RF-15, rule 3, rule 6)', () => {
  it('same currency: allocated as paid, no rate', () => {
    expect(alloc('100000.5', 'ARS', 'ARS', null)).toBe('100000.50');
    expect(paymentPair('ARS', 'ARS')).toBeNull();
  });

  it('a USD commitment paid in pesos uses the applied rate (rule 3)', () => {
    // 15.99 USD of the Visa paid with 24,465 ARS at 1530
    expect(alloc('24465', 'ARS', 'USD', '1530')).toBe('15.99');
    // the Uruguayan card: USD paid in UYU at 42.09
    expect(alloc('2424.38', 'UYU', 'USD', '42.09')).toBe('57.60');
  });

  it('a peso commitment paid in USD multiplies by the rate', () => {
    expect(alloc('100', 'USD', 'ARS', '1450')).toBe('145000.00');
    expect(alloc('100', 'USD', 'UYU', '40.5')).toBe('4050.00');
  });

  it('a conversion needs a positive rate; ARS ↔ UYU has no direct rate', () => {
    expect(() => alloc('1000', 'ARS', 'USD', null)).toThrow(/applied rate/);
    expect(() => alloc('1000', 'ARS', 'USD', '0')).toThrow(/applied rate/);
    expect(() => paymentPair('ARS', 'UYU')).toThrow(/No direct rate/);
  });
});

describe('status from payments (RF-28)', () => {
  it('nothing paid is pending; part is partially paid; covered or more is paid', () => {
    expect(paymentStatus(m('1000'), [])).toBe('pending');
    expect(paymentStatus(m('1000'), [m('300')])).toBe('partially_paid');
    expect(paymentStatus(m('1000'), [m('300'), m('700')])).toBe('paid');
    expect(paymentStatus(m('1000'), [m('1200')])).toBe('paid');
  });

  it('a zero commitment is not paid by nothing', () => {
    expect(paymentStatus(m('0'), [])).toBe('pending');
  });
});
