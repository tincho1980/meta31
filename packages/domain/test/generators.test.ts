import { describe, expect, it } from 'vitest';
import {
  type CreditCardRule,
  generateForPeriod,
  generateForRange,
  type IncomeSourceRule,
  type LoanRule,
  oneOffInstallmentAmount,
  type RecurringExpenseRule,
  type Rules,
} from '../src/generators.js';
import { type Money, moneyToDb, toMoney } from '../src/money.js';
import { type Period, toPeriod } from '../src/period.js';

const m = (s: string) => toMoney(s);
const p = (s: string) => toPeriod(s);
const show = (x: Money) => moneyToDb(x);

const empty: Rules = {
  incomeSources: [],
  recurringExpenses: [],
  oneOffExpenses: [],
  loans: [],
  creditCards: [],
  cardPaymentCategoryId: 'cat-cards',
  latestUvaValue: null,
};
const rules = (extra: Partial<Rules>): Rules => ({ ...empty, ...extra });

const salary: IncomeSourceRule = {
  id: 'salary',
  name: 'Sueldo docente',
  categoryId: 'cat-salary',
  currency: 'ARS',
  everyMonths: 1,
  anchorMonth: 1,
  expectedDay: 31,
  validFrom: '2026-01-01',
  validTo: null,
  amounts: [
    { fromPeriod: '2026-01-01', amount: m('1500000') },
    { fromPeriod: '2026-11-01', amount: m('1650000.50') },
  ],
};

describe('income sources (RF-07, RF-08, rule 7)', () => {
  it('generates the expected income with the amount in force and its key', () => {
    const [income] = generateForPeriod(rules({ incomeSources: [salary] }), p('2026-10-01')).incomes;
    expect(income).toMatchObject({
      sourceKey: 'is:salary:2026-10-01',
      incomeSourceId: 'salary',
      description: 'Sueldo docente',
      currency: 'ARS',
      expectedDate: '2026-10-31',
    });
    expect(show(income!.estimatedAmount)).toBe('1500000.00');
  });

  it('uses the updated amount from its month on', () => {
    const [income] = generateForPeriod(rules({ incomeSources: [salary] }), p('2026-11-01')).incomes;
    expect(show(income!.estimatedAmount)).toBe('1650000.50');
    expect(income!.expectedDate).toBe('2026-11-30'); // expected day 31 → last day
  });

  it('stops after its end date (rule 11) and before its start', () => {
    const ending = { ...salary, validTo: '2026-12-31' };
    expect(generateForPeriod(rules({ incomeSources: [ending] }), p('2026-12-01')).incomes).toHaveLength(1);
    expect(generateForPeriod(rules({ incomeSources: [ending] }), p('2027-01-01')).incomes).toHaveLength(0);
    expect(generateForPeriod(rules({ incomeSources: [salary] }), p('2025-12-01')).incomes).toHaveLength(0);
  });

  it('reports a source without an amount instead of dropping it silently', () => {
    const noAmount = { ...salary, amounts: [] };
    const result = generateForPeriod(rules({ incomeSources: [noAmount] }), p('2026-10-01'));
    expect(result.incomes).toHaveLength(0);
    expect(result.issues).toEqual([
      { kind: 'missing_amount', origin: 'income_source', id: 'salary', period: '2026-10-01' },
    ]);
  });
});

const tax: RecurringExpenseRule = {
  id: 'arba',
  name: 'ARBA',
  categoryId: 'cat-tax',
  currency: 'ARS',
  everyMonths: 12,
  anchorMonth: 3,
  dueDay: 15,
  validFrom: '2026-01-01',
  validTo: null,
  amounts: [{ fromPeriod: '2026-01-01', amount: m('480000') }],
};

describe('recurring expenses (D2, rule 8)', () => {
  it('a yearly tax generates a single commitment, in its payment month', () => {
    const range = generateForRange(rules({ recurringExpenses: [tax] }), p('2026-01-01'), 12);
    const months = [...range].filter(([, g]) => g.commitments.length > 0).map(([period]) => period);
    expect(months).toEqual(['2026-03-01']);
    const [c] = range.get(p('2026-03-01'))!.commitments;
    expect(c).toMatchObject({
      sourceKey: 're:arba:2026-03-01',
      origin: { kind: 'recurring_expense', id: 'arba' },
      dueDate: '2026-03-15',
      installmentNumber: null,
    });
  });

  it('a bimonthly utility falls every other month, without a due day', () => {
    const water = { ...tax, id: 'water', name: 'Agua', everyMonths: 2, anchorMonth: 2, dueDay: null };
    const range = generateForRange(rules({ recurringExpenses: [water] }), p('2026-01-01'), 6);
    const months = [...range].filter(([, g]) => g.commitments.length > 0).map(([period]) => period);
    expect(months).toEqual<Period[]>(['2026-02-01', '2026-04-01', '2026-06-01']);
    expect(range.get(p('2026-02-01'))!.commitments[0]!.dueDate).toBeNull();
  });
});

describe('one-off expenses (RF-21)', () => {
  it('splits the total into installments; the last absorbs the rounding', () => {
    expect([1, 2, 3].map((n) => show(oneOffInstallmentAmount(m('1000'), 3, n)))).toEqual(['333.33', '333.33', '333.34']);
    expect([1, 2, 3].map((n) => show(oneOffInstallmentAmount(m('100'), 3, n)))).toEqual(['33.33', '33.33', '33.34']);
    expect(show(oneOffInstallmentAmount(m('250000'), 1, 1))).toBe('250000.00');
    expect(() => oneOffInstallmentAmount(m('1'), 3, 4)).toThrow(RangeError);
  });

  it('generates each installment in its month, keyed by number, ending on its own', () => {
    const roof = {
      id: 'roof',
      description: 'Arreglo del techo',
      categoryId: 'cat-house',
      currency: 'ARS' as const,
      totalAmount: m('1000000'),
      installments: 3,
      firstPeriod: '2026-11-01',
      plannedDate: '2026-11-20',
    };
    const range = generateForRange(rules({ oneOffExpenses: [roof] }), p('2026-10-01'), 5);
    const rows = [...range].flatMap(([, g]) => g.commitments).map((c) => [c.period, c.sourceKey, c.description, show(c.estimatedAmount), c.dueDate]);
    expect(rows).toEqual([
      ['2026-11-01', 'oe:roof:1', 'Arreglo del techo (1/3)', '333333.33', '2026-11-20'],
      ['2026-12-01', 'oe:roof:2', 'Arreglo del techo (2/3)', '333333.33', null],
      ['2027-01-01', 'oe:roof:3', 'Arreglo del techo (3/3)', '333333.34', null],
    ]);
  });
});

const loan: LoanRule = {
  id: 'loan1',
  lender: 'Banco',
  categoryId: 'cat-loans',
  currency: 'ARS',
  kind: 'fixed_rate',
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

describe('loans (RF-23, rule 11)', () => {
  it('the estimated amount is the theoretical installment (same invented loan as loan.test.ts)', () => {
    const [c] = generateForPeriod(rules({ loans: [loan] }), p('2026-05-01')).commitments;
    expect(c).toMatchObject({
      sourceKey: 'ln:loan1:2',
      origin: { kind: 'loan', id: 'loan1' },
      installmentNumber: 2,
      description: 'Banco (2/18)',
      dueDate: '2026-05-31',
    });
    expect(show(c!.estimatedAmount)).toBe('214455.65');
  });

  it('stops after the last installment', () => {
    expect(generateForPeriod(rules({ loans: [loan] }), p('2027-09-01')).commitments).toHaveLength(1);
    expect(generateForPeriod(rules({ loans: [loan] }), p('2027-10-01')).commitments).toHaveLength(0);
  });

  it('UVA loans are estimated in pesos with the latest UVA value, or reported if there is none', () => {
    const uva: LoanRule = { ...loan, id: 'uva1', kind: 'uva', principal: m('1600') };
    const withValue = generateForPeriod(rules({ loans: [uva], latestUvaValue: m('1500') }), p('2026-05-01'));
    // UVA installment × 1,500 pesos per UVA, rounded to cents
    expect(withValue.commitments[0]!.estimatedAmount.gt(0)).toBe(true);
    expect(withValue.commitments[0]!.estimatedAmount.decimalPlaces()).toBeLessThanOrEqual(2);
    const without = generateForPeriod(rules({ loans: [uva] }), p('2026-05-01'));
    expect(without.commitments).toHaveLength(0);
    expect(without.issues).toEqual([{ kind: 'missing_uva_value', origin: 'loan', id: 'uva1', period: '2026-05-01' }]);
  });
});

const card: CreditCardRule = {
  id: 'visa',
  name: 'Visa Martín',
  active: true,
  localCurrency: 'ARS',
  dueDay: 10,
  estimatedSpendLocal: m('300000'),
  estimatedSpendUsd: m('0'),
  installmentPurchases: [
    { id: 'tv', currency: 'ARS', installmentAmount: m('50000'), installmentsTotal: 6, firstPeriod: '2026-07-01' },
    { id: 'flight', currency: 'USD', installmentAmount: m('120'), installmentsTotal: 3, firstPeriod: '2026-10-01' },
  ],
  subscriptions: [
    { id: 'phone', currency: 'ARS', amount: m('25000'), validFrom: '2026-01-01', validTo: null },
    { id: 'streaming', currency: 'USD', amount: m('10.99'), validFrom: '2026-01-01', validTo: '2026-11-30' },
  ],
  statements: [],
};

const cardRows = (r: Rules, period: string) =>
  generateForPeriod(r, p(period)).commitments.map((c) => [c.sourceKey, c.currency, show(c.estimatedAmount), c.description]);

describe('credit cards (RF-13, RF-14, RF-16, D4, rule 1)', () => {
  it('estimates one commitment per currency: installments + subscriptions + estimated spend', () => {
    expect(cardRows(rules({ creditCards: [card] }), '2026-10-01')).toEqual([
      ['cc:visa:2026-10-01:ARS', 'ARS', '375000.00', 'Visa Martín'], // 50,000 + 25,000 + 300,000
      ['cc:visa:2026-10-01:USD', 'USD', '130.99', 'Visa Martín (USD)'], // 120 + 10.99
    ]);
  });

  it('never generates a commitment per purchase or subscription (rule 1)', () => {
    const range = generateForRange(rules({ creditCards: [card] }), p('2026-10-01'), 12);
    for (const [, g] of range) expect(g.commitments.length).toBeLessThanOrEqual(2);
  });

  it('installments ending within the 12-month horizon stop on their own', () => {
    const range = generateForRange(rules({ creditCards: [{ ...card, estimatedSpendLocal: m('0') }] }), p('2026-10-01'), 4);
    const ars = [...range].map(([period, g]) => [period, show(g.commitments.find((c) => c.currency === 'ARS')!.estimatedAmount)]);
    // TV 6 installments Jul–Dec; phone 25,000 every month
    expect(ars).toEqual([
      ['2026-10-01', '75000.00'],
      ['2026-11-01', '75000.00'],
      ['2026-12-01', '75000.00'],
      ['2027-01-01', '25000.00'],
    ]);
  });

  it('a currency with nothing to pay generates no commitment', () => {
    // January 2027: flight ended (Oct–Dec) and streaming was cancelled in November
    expect(cardRows(rules({ creditCards: [card] }), '2027-01-01').map((r) => r[1])).toEqual(['ARS']);
  });

  it('a real statement replaces the estimate, with its own due date (RF-16)', () => {
    const withStatement = {
      ...card,
      statements: [{ period: '2026-10-01', dueDate: '2026-10-08', totalLocal: m('412345.67'), totalUsd: m('98.10') }],
    };
    const commitments = generateForPeriod(rules({ creditCards: [withStatement] }), p('2026-10-01')).commitments;
    expect(commitments.map((c) => [c.currency, show(c.estimatedAmount), c.dueDate])).toEqual([
      ['ARS', '412345.67', '2026-10-08'],
      ['USD', '98.10', '2026-10-08'],
    ]);
    // the next month is still estimated
    expect(generateForPeriod(rules({ creditCards: [withStatement] }), p('2026-11-01')).commitments[0]!.dueDate).toBe('2026-11-10');
  });

  it('an inactive card keeps its pending installments and subscriptions, but no estimated spend', () => {
    expect(cardRows(rules({ creditCards: [{ ...card, active: false }] }), '2026-10-01')[0]).toEqual([
      'cc:visa:2026-10-01:ARS',
      'ARS',
      '75000.00',
      'Visa Martín',
    ]);
  });

  it('the Uruguayan card bills in UYU and USD (rule 3)', () => {
    const uy: CreditCardRule = {
      ...card,
      id: 'uy',
      name: 'Visa Uruguay',
      localCurrency: 'UYU',
      estimatedSpendLocal: m('8000'),
      installmentPurchases: [],
      subscriptions: [],
    };
    expect(cardRows(rules({ creditCards: [uy] }), '2026-10-01').map((r) => r[0])).toEqual(['cc:uy:2026-10-01:UYU']);
  });

  it('rejects a purchase in a currency the card does not bill', () => {
    const wrong = { ...card, installmentPurchases: [{ ...card.installmentPurchases[0]!, currency: 'UYU' as const }] };
    expect(() => generateForPeriod(rules({ creditCards: [wrong] }), p('2026-10-01'))).toThrow(/UYU on card visa/);
  });

  it('uses the configured category for card payments', () => {
    const [c] = generateForPeriod(rules({ creditCards: [card] }), p('2026-10-01')).commitments;
    expect(c!.categoryId).toBe('cat-cards');
  });
});

describe('everything together', () => {
  it('generates all rule types for a month and a 12-month horizon', () => {
    const all = rules({ incomeSources: [salary], recurringExpenses: [tax], loans: [loan], creditCards: [card] });
    const march = generateForPeriod(all, p('2027-03-01'));
    expect(march.incomes.map((i) => i.sourceKey)).toEqual(['is:salary:2027-03-01']);
    expect(march.commitments.map((c) => c.sourceKey)).toEqual([
      're:arba:2027-03-01',
      'ln:loan1:12',
      'cc:visa:2027-03-01:ARS',
    ]);
    const range = generateForRange(all, p('2026-10-01'), 12);
    expect([...range.keys()]).toHaveLength(12);
    expect([...range.keys()].at(-1)).toBe('2027-09-01');
  });
});
