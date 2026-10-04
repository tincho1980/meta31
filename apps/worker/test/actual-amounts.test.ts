import type { CommitmentDetail, Loan, LoanSchedule, MonthProjection } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { generateForPeriod, toMoney, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { loadRules } from '../src/services/rules.js';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

let f: Fixtures;
let api: Client;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
  await openMonth(f.t.db, toPeriod('2026-10-01'), f.userId);
  api = await createHttpClient(f.t);
});

afterEach(async () => {
  await f.t.close();
});

const byOrigin = async (column: 'recurringExpenseId' | 'loanId', id: string) =>
  (await f.t.db.select().from(schema.commitment).where(eq(schema.commitment[column], id)))[0]!;
const setActual = (id: string, body: Record<string, unknown>) => api.put(`/api/commitments/${id}/actual`, body);

describe('real amounts (rule 10)', () => {
  it('the real amount replaces the estimate in the month and can be removed', async () => {
    const power = await byOrigin('recurringExpenseId', f.ids.power!);
    const res = await setActual(power.id, { actualAmount: '52340.50' });
    expect(await res.json()).toMatchObject({ actualAmount: '52340.50', estimatedAmount: '45000.00', amountInForce: '52340.50', deviation: null });
    const [oct] = (await (await api.get('/api/months/projection?from=2026-10-01&months=1')).json()) as MonthProjection[];
    expect(oct!.commitments.find((l) => l.id === power.id)!.amount).toBe('52340.50');

    const cleared = (await (await api.delete(`/api/commitments/${power.id}/actual`)).json()) as CommitmentDetail;
    expect(cleared).toMatchObject({ actualAmount: null, amountInForce: '45000.00' });
  });

  it('a utility bill can become the estimate from the next month on (RF-19)', async () => {
    const power = await byOrigin('recurringExpenseId', f.ids.power!);
    await setActual(power.id, { actualAmount: '52340.50', updateFollowing: true });
    const rules = await loadRules(f.t.db);
    const nov = generateForPeriod(rules, toPeriod('2026-11-01')).commitments.find((c) => c.origin.kind === 'recurring_expense');
    expect(nov!.estimatedAmount.toFixed(2)).toBe('52340.50');
    // loading it again for the same month updates that history row instead of failing
    expect((await setActual(power.id, { actualAmount: '50000', updateFollowing: true })).status).toBe(200);
  });

  it('the status follows the new amount: a payment that covered the estimate may not cover the real one', async () => {
    const power = await byOrigin('recurringExpenseId', f.ids.power!);
    await api.post(`/api/commitments/${power.id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', amountPaid: '45000', paymentMethod: 'debit' });
    expect(await (await setActual(power.id, { actualAmount: '52340.50' })).json()).toMatchObject({ status: 'partially_paid' });
    expect(await (await setActual(power.id, { actualAmount: '45000' })).json()).toMatchObject({ status: 'paid' });
  });

  it('only recurring expenses update the following months; cancelled ones take no real amount', async () => {
    const loan = await byOrigin('loanId', f.ids.loan!);
    expect(await (await setActual(loan.id, { actualAmount: '1', updateFollowing: true })).json()).toEqual({ error: 'conflict', reason: 'not_recurring' });
    await f.t.db.update(schema.commitment).set({ status: 'cancelled' }).where(eq(schema.commitment.id, loan.id));
    expect(await (await setActual(loan.id, { actualAmount: '1' })).json()).toEqual({ error: 'conflict', reason: 'cancelled' });
  });
});

describe('loan installments (RF-23, RF-25)', () => {
  it('the real installment shows its deviation from the theoretical one, here and in the schedule', async () => {
    const loan = await byOrigin('loanId', f.ids.loan!);
    const actual = toMoney(loan.estimatedAmount).plus(toMoney('2300')).toFixed(2); // late-payment interest
    const detail = (await (await setActual(loan.id, { actualAmount: actual })).json()) as CommitmentDetail;
    expect(detail.deviation!.amount).toBe('2300.00');
    expect(detail.deviation!.percent).toMatch(/^1\.\d$/);

    const schedule = (await (await api.get(`/api/loans/${f.ids.loan}/schedule`)).json()) as LoanSchedule;
    const row = schedule.rows.find((r) => r.number === loan.installmentNumber)!;
    expect(row.stored).toMatchObject({ actualAmount: actual, status: 'pending', deviation: { amount: '2300.00' } });
    expect(schedule.rows.find((r) => r.number === loan.installmentNumber! + 1)!.stored).toBeNull();
  });

  it('paid installments: the history before the first stored one, then the last one paid; the debt follows', async () => {
    const loan = await byOrigin('loanId', f.ids.loan!); // October = installment 7 of 18
    const before = ((await (await api.get('/api/loans')).json()) as Loan[])[0]!;
    expect(before).toMatchObject({ paidInstallments: 6, remainingInstallments: 12 });

    await api.post(`/api/commitments/${loan.id}/payments`, { date: '2026-10-30', paymentCurrency: 'ARS', amountPaid: loan.estimatedAmount, paymentMethod: 'debit' });
    const after = ((await (await api.get('/api/loans')).json()) as Loan[])[0]!;
    const schedule = (await (await api.get(`/api/loans/${f.ids.loan}/schedule`)).json()) as LoanSchedule;
    expect(after).toMatchObject({ paidInstallments: 7, remainingInstallments: 11, remainingPrincipal: schedule.rows[6]!.closingBalance });
    expect(schedule.rows[6]!.stored!.status).toBe('paid');
  });

  it('a split installment (D5) shows no deviation: its original only records what was paid', async () => {
    const loan = await byOrigin('loanId', f.ids.loan!);
    await api.post(`/api/commitments/${loan.id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', amountPaid: '100000', paymentMethod: 'debit' });
    await api.post(`/api/commitments/${loan.id}/postpone`, { dueDate: '2026-11-10' });
    expect(((await (await api.get(`/api/commitments/${loan.id}`)).json()) as CommitmentDetail).deviation).toBeNull();
    const schedule = (await (await api.get(`/api/loans/${f.ids.loan}/schedule`)).json()) as LoanSchedule;
    expect(schedule.rows.find((r) => r.number === loan.installmentNumber)!.stored).toMatchObject({ actualAmount: null, deviation: null, status: 'partially_paid' });
  });
});
