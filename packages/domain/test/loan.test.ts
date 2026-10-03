import { describe, expect, it } from 'vitest';
import {
  amortizationSchedule,
  installmentDeviation,
  installmentForDate,
  type LoanTerms,
  remainingPrincipal,
  uvaToPesos,
} from '../src/loan.js';
import { Money, moneyToDb, toMoney } from '../src/money.js';

const m = (s: string) => toMoney(s);
const show = (x: Money) => moneyToDb(x);

/**
 * Invented loan following the bank convention (see loan.ts): French system, fixed rate,
 * $2,400,000 in 18 installments at TNA 65 %, granted 2026-03-10, due on the last day of each
 * month from April. Expected values come from an independent calculation, not from loan.ts.
 * The same convention reproduces a real bank loan to the cent; that check lives in a local,
 * git-ignored test (*.local.test.ts) because the repo is public.
 */
const inventedLoan: LoanTerms = {
  system: 'french',
  principal: m('2400000'),
  nominalAnnualRate: m('65'),
  interestVatRate: m('0'),
  monthlyInsurance: m('0'),
  grantedDate: '2026-03-10',
  firstPeriod: '2026-04-01',
  dueDay: 31,
  installmentsTotal: 18,
};

describe('French schedule with the bank convention', () => {
  const schedule = amortizationSchedule(inventedLoan);

  it('computes every installment: principal, interest and total', () => {
    const expected = [
      ['2026-04-30', 51, '82047.74', '217972.60', '300020.34'],
      ['2026-05-31', 31, '86491.99', '127963.66', '214455.65'],
      ['2026-06-30', 30, '91176.97', '119215.00', '210391.97'],
      ['2026-07-31', 31, '96115.73', '118155.36', '214271.09'],
      ['2026-08-31', 31, '101322.00', '112849.25', '214171.25'],
      ['2026-09-30', 30, '106810.27', '103795.86', '210606.13'],
      ['2026-10-31', 31, '112595.83', '101359.21', '213955.04'],
      ['2026-11-30', 30, '118694.77', '92074.16', '210768.93'],
      ['2026-12-31', 31, '125124.07', '88590.70', '213714.77'],
      ['2027-01-31', 31, '131901.62', '81683.16', '213584.78'],
      ['2027-02-28', 28, '139046.29', '67201.32', '206247.61'],
      ['2027-03-31', 31, '146577.97', '66725.35', '213303.32'],
      ['2027-04-30', 30, '154517.61', '56742.05', '211259.66'],
      ['2027-05-31', 31, '162887.31', '50103.23', '212990.54'],
      ['2027-06-30', 30, '171710.37', '39784.80', '211495.17'],
      ['2027-07-31', 31, '181011.35', '31631.60', '212642.95'],
      ['2027-08-31', 31, '190816.13', '21638.78', '212454.91'],
      ['2027-09-30', 30, '201151.98', '10746.47', '211898.45'],
    ] as const;
    expect(schedule.map((r) => [r.dueDate, r.days, show(r.principal), show(r.interest), show(r.total)])).toEqual(expected);
  });

  it('charges the first period from the grant date: 51 days, Mar 10 to Apr 30', () => {
    // 2,400,000 × (0.65 × 51 / 365) = 217,972.60
    expect(schedule[0]!.days).toBe(51);
    expect(show(schedule[0]!.interest)).toBe('217972.60');
  });

  it('installments vary with the length of the month', () => {
    const feb = schedule.find((r) => r.dueDate === '2027-02-28')!;
    const mar = schedule.find((r) => r.dueDate === '2027-03-31')!;
    expect(feb.days).toBe(28);
    expect(mar.days).toBe(31);
    expect(feb.total.lt(mar.total)).toBe(true);
  });

  it('due day 31 falls on the last day of every month', () => {
    expect(schedule.slice(0, 12).map((r) => r.dueDate.slice(8))).toEqual([
      '30', '31', '30', '31', '31', '30', '31', '30', '31', '31', '28', '31',
    ]);
  });

  it('ends exactly at zero and the principal adds up to the loan', () => {
    expect(show(schedule.at(-1)!.closingBalance)).toBe('0.00');
    const total = schedule.reduce((acc, r) => acc.plus(r.principal), new Money(0));
    expect(show(total)).toBe('2400000.00');
  });

  it('remaining debt after paid installments (RF-25)', () => {
    expect(show(remainingPrincipal(schedule, 0))).toBe('2400000.00');
    expect(show(remainingPrincipal(schedule, 8))).toBe('1604744.70');
    expect(show(remainingPrincipal(schedule, 18))).toBe('0.00');
    expect(() => remainingPrincipal(schedule, 19)).toThrow(RangeError);
  });

  it('matches bank notices by date, not by number', () => {
    expect(installmentForDate(schedule, '2026-05-31')?.number).toBe(2);
    expect(installmentForDate(schedule, '2026-06-08')?.number).toBe(3); // any date in the month
    expect(installmentForDate(schedule, '2027-10-31')).toBeNull();
  });

  it('measures the deviation of an installment charged with late interest (RF-23)', () => {
    // 214,455.65 theoretical + 5,000.00 late interest
    const { amount, percent } = installmentDeviation(schedule[1]!.total, m('219455.65'));
    expect(show(amount)).toBe('5000.00');
    expect(percent.toDecimalPlaces(2).toFixed(2)).toBe('2.33');
  });
});

/**
 * Hand-checkable examples: TNA 36.5 % → 0.1 % per day. Granted Jan 31, due on the 28th:
 * periods of 28, 28 and 31 days.
 */
const handTerms = (system: LoanTerms['system'], extra: Partial<LoanTerms> = {}): LoanTerms => ({
  system,
  principal: m('1200'),
  nominalAnnualRate: m('36.5'),
  interestVatRate: m('0'),
  monthlyInsurance: m('0'),
  grantedDate: '2026-01-31',
  firstPeriod: '2026-02-01',
  dueDay: 28,
  installmentsTotal: 3,
  ...extra,
});

const summary = (terms: LoanTerms) =>
  amortizationSchedule(terms).map((r) => [show(r.principal), show(r.interest), show(r.total)]);

describe('German system', () => {
  it('constant principal, interest by days on the decreasing balance', () => {
    expect(summary(handTerms('german'))).toEqual([
      ['400.00', '33.60', '433.60'], // 1200 × 0.1 % × 28
      ['400.00', '22.40', '422.40'], //  800 × 0.1 % × 28
      ['400.00', '12.40', '412.40'], //  400 × 0.1 % × 31
    ]);
  });

  it('the last installment absorbs the rounding', () => {
    const rows = amortizationSchedule(handTerms('german', { principal: m('1000') }));
    expect(rows.map((r) => show(r.principal))).toEqual(['333.33', '333.33', '333.34']);
    expect(show(rows.at(-1)!.closingBalance)).toBe('0.00');
  });
});

describe('American system', () => {
  it('interest only, all the principal in the last installment', () => {
    expect(summary(handTerms('american'))).toEqual([
      ['0.00', '33.60', '33.60'],
      ['0.00', '33.60', '33.60'],
      ['1200.00', '37.20', '1237.20'],
    ]);
  });
});

describe('French system, general cases', () => {
  it('with a zero rate it splits the principal evenly', () => {
    const rows = amortizationSchedule(handTerms('french', { nominalAnnualRate: m('0'), principal: m('1000') }));
    expect(rows.map((r) => show(r.total))).toEqual(['333.33', '333.33', '333.34']);
  });

  it('adds VAT on interest and a fixed insurance charge', () => {
    const rows = amortizationSchedule(handTerms('german', { interestVatRate: m('21'), monthlyInsurance: m('50') }));
    expect([show(rows[0]!.vat), show(rows[0]!.insurance), show(rows[0]!.total)]).toEqual([
      '7.06', // 33.60 × 21 % = 7.056
      '50.00',
      '490.66', // 400 + 33.60 + 7.06 + 50
    ]);
  });

  it('rejects inconsistent terms', () => {
    expect(() => amortizationSchedule(handTerms('french', { installmentsTotal: 0 }))).toThrow(RangeError);
    expect(() => amortizationSchedule(handTerms('french', { principal: m('0') }))).toThrow(RangeError);
    expect(() => amortizationSchedule(handTerms('french', { grantedDate: '2026-03-01' }))).toThrow(/after the grant date/);
  });
});

describe('UVA loans', () => {
  it('the schedule comes out in UVAs and is converted with the UVA value', () => {
    const rows = amortizationSchedule(handTerms('german', { principal: m('1200') }));
    // 433.60 UVAs at $1,500.25 per UVA
    expect(show(uvaToPesos(rows[0]!.total, m('1500.25')))).toBe('650508.40');
  });
});
