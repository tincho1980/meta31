import type { Category, Loan, LoanSchedule, Person } from '@meta31/contracts';
import { findUserByEmail, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { addMonths, currentPeriod, dateInPeriod, generateForPeriod, toPeriod } from '@meta31/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { loadRules } from '../src/services/rules.js';
import { type Client, createHttpClient } from './http.js';

let t: TestDb;
let api: Client;
let martin: Person;
let loansCat: Category;

beforeEach(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  api = await createHttpClient(t);
  martin = ((await (await api.get('/api/people')).json()) as Person[])[0]!;
  loansCat = (await (await api.post('/api/categories', { name: 'Préstamos', kind: 'expense' })).json()) as Category;
});

afterEach(async () => {
  await t.close();
});

/** Invented loan (the repo is public): same convention as the real one validated locally. */
const personalLoan = () => ({
  lender: 'Banco',
  holderId: martin.id,
  categoryId: loansCat.id,
  currency: 'ARS',
  kind: 'fixed_rate',
  amortizationSystem: 'french',
  principal: '2400000',
  principalUva: null,
  nominalAnnualRate: '65',
  effectiveAnnualRate: null,
  totalFinancialCost: null,
  interestVatRate: '21',
  monthlyInsurance: '1500',
  grantedDate: '2026-03-10',
  installmentsTotal: 18,
  firstPeriod: '2026-04-01',
  dueDay: 31,
  quotedInstallment: null,
});

async function create(overrides: Record<string, unknown> = {}): Promise<Loan> {
  const res = await api.post('/api/loans', { ...personalLoan(), ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as Loan;
}

describe('loans API (RF-22, RF-23)', () => {
  it('creates a loan; its schedule closes at zero and feeds the projection', async () => {
    const loan = await create({ quotedInstallment: '250000' });
    expect(loan).toMatchObject({ lastPeriod: '2027-09-01', quotedInstallment: '250000.00' });

    const schedule = (await (await api.get(`/api/loans/${loan.id}/schedule`)).json()) as LoanSchedule;
    expect(schedule.unit).toBe('ARS');
    expect(schedule.rows).toHaveLength(18);
    expect(schedule.rows[0]).toMatchObject({ number: 1, dueDate: '2026-04-30', days: 51, total: loan.firstInstallment });
    expect(schedule.rows.at(-1)!.closingBalance).toBe('0.00');

    // the same schedule estimates the installment of a future month
    const oct = generateForPeriod(await loadRules(t.db), toPeriod('2026-10-01')).commitments;
    expect(oct.map((c) => c.estimatedAmount.toFixed(2))).toEqual([schedule.rows[6]!.total]);
  });

  it('a UVA loan needs its principal in UVAs, is in pesos, and is scheduled in UVAs', async () => {
    const missing = await api.post('/api/loans', { ...personalLoan(), kind: 'uva' });
    expect(((await missing.json()) as { fields: Record<string, string> }).fields).toEqual({ principalUva: 'uva_principal' });
    const usd = await api.post('/api/loans', { ...personalLoan(), kind: 'uva', principalUva: '1500', currency: 'USD' });
    expect(await usd.json()).toEqual({ error: 'conflict', reason: 'uva_currency' });

    const uva = await create({ kind: 'uva', principalUva: '1500.5', interestVatRate: '0', monthlyInsurance: '0', amortizationSystem: 'german' });
    const schedule = (await (await api.get(`/api/loans/${uva.id}/schedule`)).json()) as LoanSchedule;
    expect(schedule.unit).toBe('UVA');
    expect(schedule.rows[0]!.openingBalance).toBe('1500.500000');
    expect(schedule.rows.at(-1)!.closingBalance).toBe('0.000000');
  });

  it('the first due date must come after the grant date', async () => {
    const sameMonth = await api.post('/api/loans', { ...personalLoan(), grantedDate: '2026-04-20', dueDay: 10 });
    expect(await sameMonth.json()).toEqual({ error: 'conflict', reason: 'granted_after_first_due' });
    const later = await api.post('/api/loans', { ...personalLoan(), grantedDate: '2026-05-02' });
    expect(((await later.json()) as { fields: Record<string, string> }).fields).toEqual({ firstPeriod: 'range' });
    const loan = await create();
    const edit = await api.patch(`/api/loans/${loan.id}`, { grantedDate: '2026-04-30' });
    expect(await edit.json()).toEqual({ error: 'conflict', reason: 'granted_after_first_due' });
  });

  it('validates rates, amounts, system and installments', async () => {
    const res = await api.post('/api/loans', {
      ...personalLoan(),
      amortizationSystem: 'italian',
      principal: '0',
      nominalAnnualRate: '1000',
      interestVatRate: '10.555',
      installmentsTotal: 0,
      dueDay: 40,
    });
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({
      amortizationSystem: 'choice',
      principal: 'must_be_positive',
      nominalAnnualRate: 'decimal',
      interestVatRate: 'decimal',
      installmentsTotal: 'installments',
      dueDay: 'day',
    });
  });

  it('edits the terms; switching to UVA without a UVA principal is refused', async () => {
    const loan = await create();
    const edited = await api.patch(`/api/loans/${loan.id}`, { installmentsTotal: 12, nominalAnnualRate: '60.5' });
    expect(await edited.json()).toMatchObject({ installmentsTotal: 12, lastPeriod: '2027-03-01', nominalAnnualRate: '60.500000' });
    const uva = await api.patch(`/api/loans/${loan.id}`, { kind: 'uva' });
    expect(await uva.json()).toEqual({ error: 'conflict', reason: 'uva_principal' });
  });

  it('deletes a loan while none of its installments is stored', async () => {
    const mistake = await create({ lender: 'Error' });
    expect((await api.delete(`/api/loans/${mistake.id}`)).status).toBe(204);
    const loan = await create();
    const userId = (await findUserByEmail(t.db, 'martin@example.com'))!.id;
    await openMonth(t.db, toPeriod('2026-10-01'), userId);
    expect(await (await api.delete(`/api/loans/${loan.id}`)).json()).toEqual({ error: 'conflict', reason: 'has_stored_commitments' });
  });

  it('reports the installment of the current month and the theoretical remaining principal (RF-25)', async () => {
    const first = addMonths(currentPeriod(), -2);
    const granted = dateInPeriod(addMonths(first, -1), 10);
    const loan = await create({ firstPeriod: first, grantedDate: granted });
    const schedule = (await (await api.get(`/api/loans/${loan.id}/schedule`)).json()) as LoanSchedule;
    expect(loan.currentInstallment).toEqual({ number: 3, dueDate: schedule.rows[2]!.dueDate, total: schedule.rows[2]!.total });
    expect(loan.remainingPrincipal).toBe(schedule.rows[2]!.openingBalance);
  });
});
