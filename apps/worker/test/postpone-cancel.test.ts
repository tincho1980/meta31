import type { CancelledLine, CommitmentDetail, MonthProjection } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { toMoney, toPeriod } from '@meta31/domain';
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

const loanCommitment = async () => (await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.loanId, f.ids.loan!)))[0]!;
const month = async (period: string) =>
  ((await (await api.get(`/api/months/projection?from=${period}&months=1`)).json()) as MonthProjection[])[0]!;
const postpone = async (id: string, dueDate: string) => api.post(`/api/commitments/${id}/postpone`, { dueDate });

describe('postponing (D5, RF-28)', () => {
  it('moves the commitment to the new month; the origin month never changes; it can move again', async () => {
    const loan = await loanCommitment();
    const moved = (await (await postpone(loan.id, '2026-11-15')).json()) as CommitmentDetail;
    expect(moved).toMatchObject({ period: '2026-11-01', originPeriod: '2026-10-01', dueDate: '2026-11-15', status: 'pending' });

    expect((await month('2026-10-01')).commitments.some((l) => l.id === loan.id)).toBe(false);
    const nov = await month('2026-11-01');
    expect(nov.commitments.find((l) => l.id === loan.id)).toMatchObject({ postponed: true, date: '2026-11-15' });

    const again = (await (await postpone(loan.id, '2026-12-10')).json()) as CommitmentDetail;
    expect(again).toMatchObject({ period: '2026-12-01', originPeriod: '2026-10-01' });
  });

  it('within the same month only the due date changes ("lo pasaste al 15")', async () => {
    const loan = await loanCommitment();
    const moved = (await (await postpone(loan.id, '2026-10-15')).json()) as CommitmentDetail;
    expect(moved).toMatchObject({ period: '2026-10-01', dueDate: '2026-10-15' });
    expect((await month('2026-10-01')).commitments.find((l) => l.id === loan.id)!.postponed).toBe(false);
  });

  it('a partial payment and the rest postponed splits it: the original paid by what was paid, a child with the rest', async () => {
    const loan = await loanCommitment();
    await api.post(`/api/commitments/${loan.id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', amountPaid: '100000', paymentMethod: 'transfer' });
    const child = (await (await postpone(loan.id, '2026-11-10')).json()) as CommitmentDetail;
    const rest = toMoney(loan.estimatedAmount).minus(toMoney('100000'));
    expect(child).toMatchObject({ period: '2026-11-01', originPeriod: '2026-10-01', status: 'pending', amountInForce: rest.toFixed(2) });

    const original = (await (await api.get(`/api/commitments/${loan.id}`)).json()) as CommitmentDetail;
    expect(original).toMatchObject({ status: 'paid', amountInForce: '100000.00', paid: '100000.00', period: '2026-10-01' });
    const [row] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.id, child.id));
    expect(row).toMatchObject({ parentCommitmentId: loan.id, sourceKey: null, loanId: f.ids.loan });

    expect((await month('2026-11-01')).commitments.find((l) => l.id === child.id)).toMatchObject({ postponed: true });
  });

  it('refuses paid, cancelled or backwards', async () => {
    const loan = await loanCommitment();
    expect(await (await postpone(loan.id, '2026-09-30')).json()).toEqual({ error: 'conflict', reason: 'postpone_backwards' });
    await api.post(`/api/commitments/${loan.id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', amountPaid: loan.estimatedAmount, paymentMethod: 'transfer' });
    expect(await (await postpone(loan.id, '2026-11-15')).json()).toEqual({ error: 'conflict', reason: 'already_paid' });
  });
});

describe('cancelling and restoring (RF-28)', () => {
  it('a cancelled commitment stops counting, is listed as cancelled and can be restored', async () => {
    const loan = await loanCommitment();
    const noReason = await api.post(`/api/commitments/${loan.id}/cancel`, { reason: '  ' });
    expect(((await noReason.json()) as { fields: Record<string, string> }).fields).toEqual({ reason: 'required' });

    const res = await api.post(`/api/commitments/${loan.id}/cancel`, { reason: 'Cargado por error' });
    expect(await res.json()).toMatchObject({ status: 'cancelled', cancellationReason: 'Cargado por error' });
    expect((await month('2026-10-01')).commitments.some((l) => l.id === loan.id)).toBe(false);
    const cancelled = (await (await api.get('/api/months/2026-10-01/cancelled')).json()) as CancelledLine[];
    expect(cancelled).toEqual([expect.objectContaining({ id: loan.id, kind: 'commitment', reason: 'Cargado por error' })]);

    expect(await (await api.post(`/api/commitments/${loan.id}/restore`, {})).json()).toMatchObject({ status: 'pending', cancellationReason: null });
    expect((await month('2026-10-01')).commitments.some((l) => l.id === loan.id)).toBe(true);
  });

  it('a commitment with payments is not cancelled (undo them first)', async () => {
    const loan = await loanCommitment();
    await api.post(`/api/commitments/${loan.id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', amountPaid: '1000', paymentMethod: 'cash' });
    expect(await (await api.post(`/api/commitments/${loan.id}/cancel`, { reason: 'x' })).json()).toEqual({ error: 'conflict', reason: 'has_payments' });
  });

  it('an expected income can be cancelled and restored', async () => {
    const [salary] = await f.t.db.select().from(schema.income).where(eq(schema.income.incomeSourceId, f.ids.salary!));
    expect(await (await api.post(`/api/incomes/${salary!.id}/cancel`, {})).json()).toMatchObject({ status: 'cancelled' });
    expect((await month('2026-10-01')).incomes).toEqual([]);
    expect(((await (await api.get('/api/months/2026-10-01/cancelled')).json()) as CancelledLine[]).map((l) => l.kind)).toEqual(['income']);
    expect(await (await api.post(`/api/incomes/${salary!.id}/restore`, {})).json()).toMatchObject({ status: 'expected' });
    expect(await (await api.post(`/api/incomes/${salary!.id}/restore`, {})).json()).toEqual({ error: 'conflict', reason: 'not_cancelled' });
  });
});
