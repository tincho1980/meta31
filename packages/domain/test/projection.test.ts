import { describe, expect, it } from 'vitest';
import type { ExchangeRate } from '../src/exchange.js';
import type { CreditCardRule, IncomeSourceRule, LoanRule, Rules } from '../src/generators.js';
import { type Money, moneyToDb, toMoney } from '../src/money.js';
import { toPeriod } from '../src/period.js';
import { type ProjectionInput, projectMonths, type StoredCommitment, type StoredIncome } from '../src/projection.js';

const m = (s: string) => toMoney(s);
const p = (s: string) => toPeriod(s);
const show = (x: Money | null | undefined) => (x == null ? null : moneyToDb(x));

const salary: IncomeSourceRule = {
  id: 'salary', name: 'Sueldo', categoryId: 'c-inc', currency: 'ARS', everyMonths: 1, anchorMonth: 1,
  expectedDay: 5, validFrom: '2026-01-01', validTo: null, amounts: [{ fromPeriod: '2026-01-01', amount: m('2000000') }],
};
const rent: IncomeSourceRule = {
  id: 'rent', name: 'Alquiler Pocitos', categoryId: 'c-inc', currency: 'UYU', everyMonths: 1, anchorMonth: 1,
  expectedDay: 10, validFrom: '2026-01-01', validTo: null, amounts: [{ fromPeriod: '2026-01-01', amount: m('40000') }],
};
const loan: LoanRule = {
  id: 'loan1', lender: 'Banco', categoryId: 'c-loan', currency: 'ARS', kind: 'fixed_rate', system: 'french',
  principal: m('2400000'), nominalAnnualRate: m('65'), interestVatRate: m('0'), monthlyInsurance: m('0'),
  grantedDate: '2026-03-10', firstPeriod: '2026-04-01', dueDay: 31, installmentsTotal: 18,
};
const card: CreditCardRule = {
  id: 'visa', name: 'Visa', active: true, localCurrency: 'ARS', dueDay: 8,
  estimatedSpendLocal: m('300000'), estimatedSpendUsd: m('0'),
  installmentPurchases: [{ id: 'tv', currency: 'ARS', installmentAmount: m('100000'), installmentsTotal: 2, firstPeriod: '2026-10-01' }],
  subscriptions: [], statements: [],
};
const rules: Rules = {
  incomeSources: [salary, rent], recurringExpenses: [], oneOffExpenses: [], loans: [loan], creditCards: [card],
  cardPaymentCategoryId: 'c-cards', latestUvaValue: null,
};
// USD_ARS = ARS per USD; UYU_USD = UYU per USD
const rates: ExchangeRate[] = [
  { pair: 'USD_ARS', validFrom: '2026-01-01', rate: m('1450') },
  { pair: 'UYU_USD', validFrom: '2026-01-01', rate: m('40') },
];

const input = (extra: Partial<ProjectionInput> = {}): ProjectionInput => ({
  rules, commitments: [], incomes: [], storedKeys: new Set(), rates, from: p('2026-10-01'), months: 12, ...extra,
});

const stored = (extra: Partial<StoredCommitment>): StoredCommitment => ({
  id: 'c1', sourceKey: null, origin: { kind: 'loan', id: 'loan1' }, description: 'x', categoryId: 'c-loan',
  originPeriod: '2026-10-01', period: '2026-10-01', dueDate: null, currency: 'ARS',
  estimatedAmount: m('0'), actualAmount: null, surcharge: m('0'), status: 'pending', ...extra,
});

describe('monthly projection (RF-31)', () => {
  const [oct, nov, dec] = projectMonths(input());

  it('sums incomes and commitments of the month from all the rules', () => {
    // incomes: 2,000,000 ARS + 40,000 UYU; commitments: loan 7 (213,955.04) + card (100,000 + 300,000)
    expect(oct!.incomes.map((l) => l.description)).toEqual(['Sueldo', 'Alquiler Pocitos']);
    expect(oct!.commitments.map((l) => [l.origin, show(l.amount)])).toEqual([
      ['loan', '213955.04'],
      ['credit_card', '400000.00'],
    ]);
    expect(show(oct!.byCurrency.ARS.result)).toBe('1386044.96');
    expect(show(oct!.byCurrency.UYU.incomes)).toBe('40000.00');
  });

  it('gives the totals in ARS and in USD, converting UYU through USD', () => {
    // 40,000 UYU = 1,000 USD = 1,450,000 ARS
    expect([show(oct!.ars!.incomes), show(oct!.ars!.commitments), show(oct!.ars!.result)]).toEqual([
      '3450000.00', '613955.04', '2836044.96',
    ]);
    expect(show(oct!.usd!.incomes)).toBe('2379.31'); // 3,450,000 / 1,450
  });

  it('does not carry the result over to the next month (rule 9)', () => {
    // November has the same incomes; the card has the second and last TV installment
    expect(show(nov!.ars!.incomes)).toBe('3450000.00');
    expect(nov!.commitments.find((l) => l.origin === 'credit_card')!.amount.toFixed(2)).toBe('400000.00');
    expect(dec!.commitments.find((l) => l.origin === 'credit_card')!.amount.toFixed(2)).toBe('300000.00');
  });

  it('covers the 12-month horizon and stops projecting the loan after its last installment', () => {
    const months = projectMonths(input({ months: 13 }));
    expect(months.map((mo) => mo.period).at(-1)).toBe('2027-10-01');
    expect(months.at(-2)!.commitments.some((l) => l.origin === 'loan')).toBe(true); // Sep 2027: installment 18
    expect(months.at(-1)!.commitments.some((l) => l.origin === 'loan')).toBe(false);
  });
});

describe('stored and virtual together (D1, D5)', () => {
  it('a stored row replaces its virtual candidate, using its actual amount and surcharge', () => {
    const [oct] = projectMonths(input({
      commitments: [stored({ id: 'ln7', sourceKey: 'ln:loan1:7', estimatedAmount: m('213955.04'), actualAmount: m('219000'), surcharge: m('1500') })],
      storedKeys: new Set(['ln:loan1:7']),
    }));
    const loanLines = oct!.commitments.filter((l) => l.origin === 'loan');
    expect(loanLines.map((l) => [l.id, l.stored, show(l.amount)])).toEqual([['ln7', true, '220500.00']]);
  });

  it('a commitment postponed to the next month counts there, flagged, and not in its origin month', () => {
    const postponed = stored({ id: 'ln7', sourceKey: 'ln:loan1:7', period: '2026-11-01', estimatedAmount: m('213955.04') });
    const [oct, nov] = projectMonths(input({ commitments: [postponed], storedKeys: new Set(['ln:loan1:7']) }));
    expect(oct!.commitments.some((l) => l.origin === 'loan')).toBe(false);
    const novLoans = nov!.commitments.filter((l) => l.origin === 'loan');
    expect(novLoans.map((l) => [l.sourceKey, l.postponed])).toEqual([
      ['ln:loan1:7', true],
      ['ln:loan1:8', false],
    ]);
  });

  it('a cancelled commitment counts nowhere and is not regenerated', () => {
    const cancelled = stored({ id: 'cc', sourceKey: 'cc:visa:2026-10-01:ARS', origin: { kind: 'credit_card', id: 'visa' }, status: 'cancelled', estimatedAmount: m('400000') });
    const [oct] = projectMonths(input({ commitments: [cancelled], storedKeys: new Set(['cc:visa:2026-10-01:ARS']) }));
    expect(oct!.commitments.some((l) => l.origin === 'credit_card')).toBe(false);
  });

  it('includes stored one-off incomes and uses the actual amount once received', () => {
    const extra: StoredIncome = {
      id: 'i1', sourceKey: null, incomeSourceId: null, description: 'Proyecto Adavra', categoryId: 'c-inc', period: '2026-10-01',
      expectedDate: '2026-10-20', currency: 'USD', estimatedAmount: m('500'), actualAmount: m('520'), status: 'received',
    };
    const [oct] = projectMonths(input({ incomes: [extra] }));
    expect(oct!.incomes.find((l) => l.id === 'i1')).toMatchObject({ origin: 'one_off_income', stored: true });
    expect(show(oct!.byCurrency.USD.incomes)).toBe('520.00');
  });
});

describe('installment load (RF-33)', () => {
  it('card installments + loan installments over the income, in ARS', () => {
    const [oct, , dec] = projectMonths(input());
    // October: TV 100,000 + loan 213,955.04 = 313,955.04 over 3,450,000 → 9.10 %
    expect(show(oct!.installmentLoad!.amountArs)).toBe('313955.04');
    expect(oct!.installmentLoad!.percent!.toDecimalPlaces(2).toFixed(2)).toBe('9.10');
    // December: the TV is paid off, only the loan remains
    expect(show(dec!.installmentLoad!.amountArs)).toBe(show(dec!.commitments.find((l) => l.origin === 'loan')!.amount));
  });

  it('without income the percent is empty instead of dividing by zero', () => {
    const [oct] = projectMonths(input({ rules: { ...rules, incomeSources: [] } }));
    expect(oct!.installmentLoad!.percent).toBeNull();
  });
});

describe('lines in ARS (for subtotals by category)', () => {
  it('converts each line on its own: UYU through USD, ARS as is', () => {
    const [oct] = projectMonths(input());
    // 40,000 UYU / 40 * 1450 = 1,450,000 ARS
    expect(oct!.incomes.map((l) => show(l.amountArs))).toEqual(['2000000.00', '1450000.00']);
    expect(show(oct!.commitments[0]!.amountArs)).toBe('213955.04');
  });

  it('a missing rate blanks only the lines that need it', () => {
    const [oct] = projectMonths(input({ rates: [rates[0]!] }));
    expect(oct!.incomes.map((l) => show(l.amountArs))).toEqual(['2000000.00', null]);
  });
});

describe('missing exchange rates', () => {
  it('keeps the per-currency totals and reports the missing rate instead of failing', () => {
    const [oct] = projectMonths(input({ rates: [] }));
    expect(oct!.ars).toBeNull();
    expect(oct!.usd).toBeNull();
    expect(oct!.installmentLoad).toBeNull();
    expect(show(oct!.byCurrency.ARS.incomes)).toBe('2000000.00');
    expect(oct!.issues).toContainEqual(expect.objectContaining({ kind: 'missing_rate', period: '2026-10-01' }));
  });

  it('an all-ARS month without UYU needs only USD_ARS', () => {
    const arsOnly = { ...rules, incomeSources: [salary] };
    const [oct] = projectMonths(input({ rules: arsOnly, rates: [rates[0]!] }));
    expect(show(oct!.ars!.incomes)).toBe('2000000.00');
  });
});
