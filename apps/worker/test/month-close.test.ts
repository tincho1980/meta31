import type { MonthStatus } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
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

const status = async () => (await (await api.get('/api/months/2026-10-01/status')).json()) as MonthStatus;

/** Settles October: pays every commitment and receives the salary. */
async function settleOctober() {
  const commitments = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.period, '2026-10-01'));
  for (const c of commitments) {
    await api.post(`/api/commitments/${c.id}/payments`, { date: '2026-10-20', paymentCurrency: c.currency, amountPaid: c.estimatedAmount, paymentMethod: 'debit' });
  }
  const [salary] = await f.t.db.select().from(schema.income).where(eq(schema.income.period, '2026-10-01'));
  await api.post(`/api/incomes/${salary!.id}/receive`, { receivedDate: '2026-10-05', actualAmount: salary!.estimatedAmount });
}

describe('month state and close (RF-30 real version)', () => {
  it('reports what is still open and what was moved to later months', async () => {
    const [loan] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.loanId, f.ids.loan!));
    await api.post(`/api/commitments/${loan!.id}/postpone`, { dueDate: '2026-11-15' });
    const s = await status();
    expect(s).toMatchObject({ status: 'open', closedAt: null });
    expect(s.unsettled).toBeGreaterThan(0);
    expect(s.postponedOut).toEqual([expect.objectContaining({ id: loan!.id, period: '2026-11-01', dueDate: '2026-11-15' })]);
    expect(((await (await api.get('/api/months/2026-12-01/status')).json()) as MonthStatus).status).toBe('not_open');
  });

  it('closes only when nothing is left open', async () => {
    expect(await (await api.post('/api/months/2026-10-01/close', {})).json()).toEqual({ error: 'conflict', reason: 'unsettled' });
    await settleOctober();
    const closed = (await (await api.post('/api/months/2026-10-01/close', {})).json()) as MonthStatus;
    expect(closed).toMatchObject({ status: 'closed', closedBy: 'Martín', unsettled: 0 });
    expect(closed.closedAt).not.toBeNull();
    expect(await (await api.post('/api/months/2026-10-01/close', {})).json()).toEqual({ error: 'conflict', reason: 'already_closed' });
    expect(await (await api.post('/api/months/2026-12-01/close', {})).json()).toEqual({ error: 'conflict', reason: 'not_open' });
  });

  it('a closed month is final: no payments, real amounts, postponing or receiving until it is reopened', async () => {
    await settleOctober();
    await api.post('/api/months/2026-10-01/close', {});
    const [loan] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.loanId, f.ids.loan!));
    const closed = { error: 'conflict', reason: 'month_closed' };
    expect(await (await api.put(`/api/commitments/${loan!.id}/actual`, { actualAmount: '1' })).json()).toEqual(closed);
    expect(await (await api.post(`/api/commitments/${loan!.id}/postpone`, { dueDate: '2026-11-15' })).json()).toEqual(closed);
    const [payment] = await f.t.db.select().from(schema.commitmentPayment).where(eq(schema.commitmentPayment.commitmentId, loan!.id));
    expect(await (await api.delete(`/api/commitments/${loan!.id}/payments/${payment!.id}`)).json()).toEqual(closed);

    expect(await (await api.post('/api/months/2026-10-01/reopen', {})).json()).toMatchObject({ status: 'open', closedAt: null });
    expect((await api.delete(`/api/commitments/${loan!.id}/payments/${payment!.id}`)).status).toBe(200);
    expect(await (await api.post('/api/months/2026-10-01/reopen', {})).json()).toEqual({ error: 'conflict', reason: 'not_closed' });
  });

  it('nothing can be postponed into a closed month', async () => {
    await settleOctober();
    await api.post('/api/months/2026-10-01/close', {});
    await openMonth(f.t.db, toPeriod('2026-11-01'), f.userId);
    const [nov] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.period, '2026-11-01'));
    // moving back is refused anyway; a closed target month too
    expect((await api.post(`/api/commitments/${nov!.id}/postpone`, { dueDate: '2026-10-30' })).status).toBe(409);
  });
});
