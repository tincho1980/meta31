import type { CommitmentDetail, IncomeDetail, MonthProjection } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { toPeriod } from '@meta31/domain';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

let f: Fixtures;
let api: Client;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
  // a USD subscription, so the card also has a USD commitment (D4)
  const [cat] = await f.t.db.select().from(schema.category).where(eq(schema.category.name, 'Casa'));
  await f.t.db.insert(schema.subscription).values({
    creditCardId: f.ids.card!,
    description: 'Streaming',
    categoryId: cat!.id,
    currency: 'USD',
    amount: '20',
    validFrom: '2026-01-01',
  });
  await openMonth(f.t.db, toPeriod('2026-10-01'), f.userId);
  api = await createHttpClient(f.t);
});

afterEach(async () => {
  await f.t.close();
});

const commitmentOf = async (where: ReturnType<typeof eq>) => (await f.t.db.select().from(schema.commitment).where(where))[0]!;
const loanCommitment = () => commitmentOf(eq(schema.commitment.loanId, f.ids.loan!));
const usdCard = () => commitmentOf(and(eq(schema.commitment.creditCardId, f.ids.card!), eq(schema.commitment.currency, 'USD'))!);

const pay = (id: string, body: Record<string, unknown>) =>
  api.post(`/api/commitments/${id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', paymentMethod: 'transfer', ...body });

describe('paying commitments (RF-28)', () => {
  it('a full payment marks it paid and the month view shows what was paid', async () => {
    const loan = await loanCommitment();
    const res = await pay(loan.id, { amountPaid: loan.estimatedAmount, paymentMethod: 'debit' });
    expect(res.status).toBe(201);
    const detail = (await res.json()) as CommitmentDetail;
    expect(detail).toMatchObject({ status: 'paid', paid: loan.estimatedAmount, amountInForce: loan.estimatedAmount });
    expect(detail.payments[0]).toMatchObject({ paymentCurrency: 'ARS', appliedRate: null, paymentMethod: 'debit' });

    const [oct] = (await (await api.get('/api/months/projection?from=2026-10-01&months=1')).json()) as MonthProjection[];
    expect(oct!.commitments.find((l) => l.id === loan.id)).toMatchObject({ status: 'paid', paid: loan.estimatedAmount });
  });

  it('a partial payment, then the rest; undoing one recomputes the status', async () => {
    const loan = await loanCommitment();
    const first = (await (await pay(loan.id, { amountPaid: '100000' })).json()) as CommitmentDetail;
    expect(first).toMatchObject({ status: 'partially_paid', paid: '100000.00' });
    const rest = (await (await pay(loan.id, { amountPaid: first.amountInForce })).json()) as CommitmentDetail;
    expect(rest.status).toBe('paid');
    const undone = (await (await api.delete(`/api/commitments/${loan.id}/payments/${rest.payments[1]!.id}`)).json()) as CommitmentDetail;
    expect(undone).toMatchObject({ status: 'partially_paid', paid: '100000.00' });
  });

  it('a USD commitment paid in pesos keeps the applied rate, given or in force (rule 3)', async () => {
    const usd = await usdCard();
    const given = (await (await pay(usd.id, { amountPaid: '15300', appliedRate: '1530' })).json()) as CommitmentDetail;
    expect(given.payments[0]).toMatchObject({ appliedRate: '1530.000000', allocatedAmount: '10.00' });
    const inForce = (await (await pay(usd.id, { amountPaid: '14500' })).json()) as CommitmentDetail;
    expect(inForce.payments[1]).toMatchObject({ appliedRate: '1450.000000', allocatedAmount: '10.00' });
    expect(inForce.status).toBe('paid');
  });

  it('a backdated rate loaded later never changes a payment (rule 6)', async () => {
    const usd = await usdCard();
    await pay(usd.id, { amountPaid: '14500' });
    await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-10-01', rate: '1600' });
    const detail = (await (await api.get(`/api/commitments/${usd.id}`)).json()) as CommitmentDetail;
    expect(detail.payments[0]).toMatchObject({ appliedRate: '1450.000000', allocatedAmount: '10.00' });
  });

  it('refuses a cancelled commitment, a currency with no direct rate, or a missing rate', async () => {
    const loan = await loanCommitment();
    expect(await (await pay(loan.id, { amountPaid: '1000', paymentCurrency: 'UYU' })).json()).toEqual({ error: 'conflict', reason: 'payment_currency' });
    const usd = await usdCard();
    const early = await pay(usd.id, { amountPaid: '1000', date: '2025-12-31' });
    expect(await early.json()).toEqual({ error: 'conflict', reason: 'missing_rate' });
    await f.t.db.update(schema.commitment).set({ status: 'cancelled' }).where(eq(schema.commitment.id, loan.id));
    expect(await (await pay(loan.id, { amountPaid: '1000' })).json()).toEqual({ error: 'conflict', reason: 'cancelled' });
    expect((await pay('00000000-0000-4000-8000-000000000000', { amountPaid: '1' })).status).toBe(404);
  });

  it('validates the payment', async () => {
    const loan = await loanCommitment();
    const res = await pay(loan.id, { amountPaid: '0', paymentMethod: 'cheque', date: '2026-02-30' });
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({
      amountPaid: 'must_be_positive',
      paymentMethod: 'choice',
      date: 'date',
    });
  });
});

describe('receiving incomes (RF-08)', () => {
  it('marks it received with the real amount, and can be undone', async () => {
    const [salary] = await f.t.db.select().from(schema.income).where(eq(schema.income.incomeSourceId, f.ids.salary!));
    const res = await api.post(`/api/incomes/${salary!.id}/receive`, { receivedDate: '2026-10-05', actualAmount: '1520000' });
    expect(await res.json()).toMatchObject({ status: 'received', actualAmount: '1520000.00', appliedRate: null });

    const [oct] = (await (await api.get('/api/months/projection?from=2026-10-01&months=1')).json()) as MonthProjection[];
    expect(oct!.incomes[0]).toMatchObject({ status: 'received', amount: '1520000.00' });

    const undone = (await (await api.delete(`/api/incomes/${salary!.id}/receive`)).json()) as IncomeDetail;
    expect(undone).toMatchObject({ status: 'expected', actualAmount: null });
    expect(await (await api.delete(`/api/incomes/${salary!.id}/receive`)).json()).toEqual({ error: 'conflict', reason: 'not_received' });
  });

  it('a USD income keeps the rate in force on the day it came in', async () => {
    const [cat] = await f.t.db.select().from(schema.category).where(eq(schema.category.name, 'Sueldos'));
    const [usd] = await f.t.db
      .insert(schema.income)
      .values({ description: 'Proyecto', categoryId: cat!.id, period: '2026-10-01', currency: 'USD', estimatedAmount: '800' })
      .returning();
    const res = await api.post(`/api/incomes/${usd!.id}/receive`, { receivedDate: '2026-10-15', actualAmount: '750' });
    expect(await res.json()).toMatchObject({ status: 'received', appliedRate: '1450.000000' });
  });
});
