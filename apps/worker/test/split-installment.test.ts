import type { CommitmentDetail, LoanReport, LoanSchedule, MonthProjection } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { toMoney, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

/**
 * A split installment (D5: part paid, the rest postponed) seen from every place that reads
 * amounts: it must never be counted twice, and its "real amount" is the whole installment's.
 */
let f: Fixtures;
let api: Client;
let original: CommitmentDetail;
let child: CommitmentDetail;
let theoretical: string;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
  await openMonth(f.t.db, toPeriod('2026-10-01'), f.userId);
  api = await createHttpClient(f.t);
  const [loan] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.loanId, f.ids.loan!));
  theoretical = loan!.estimatedAmount;
  await api.post(`/api/commitments/${loan!.id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', amountPaid: '100000', paymentMethod: 'debit' });
  child = (await (await api.post(`/api/commitments/${loan!.id}/postpone`, { dueDate: '2026-11-10' })).json()) as CommitmentDetail;
  original = (await (await api.get(`/api/commitments/${loan!.id}`)).json()) as CommitmentDetail;
});

afterEach(async () => {
  await f.t.close();
});

/** The installment's amount across October and November, as the projection counts it. */
async function countedTotal() {
  const months = (await (await api.get('/api/months/projection?from=2026-10-01&months=2')).json()) as MonthProjection[];
  const parts = months.flatMap((m) => m.commitments.filter((l) => l.id === original.id || l.id === child.id));
  return parts.reduce((acc, l) => acc.plus(toMoney(l.amount)), toMoney('0')).toFixed(2);
}

describe('split installment (D5) across the system', () => {
  it('the parts add up to the installment exactly once', async () => {
    expect(original).toMatchObject({ status: 'paid', paid: '100000.00', amountInForce: '100000.00' });
    expect(await countedTotal()).toBe(theoretical);
  });

  it('the original part takes no real amount and cannot drop back to the full installment', async () => {
    expect(await (await api.delete(`/api/commitments/${original.id}/actual`)).json()).toEqual({ error: 'conflict', reason: 'split_part' });
    expect(await (await api.put(`/api/commitments/${original.id}/actual`, { actualAmount: '1' })).json()).toEqual({ error: 'conflict', reason: 'split_part' });
    expect(await countedTotal()).toBe(theoretical);
  });

  it('the real installment is the paid part plus the rest; the deviation appears once the rest is real', async () => {
    const empty = { deviation: null };
    expect(original).toMatchObject(empty);
    let [report] = (await (await api.get('/api/reports/loans')).json()) as LoanReport[];
    expect(report!.deviations).toEqual([]);

    // the bank charged 2,300 more: the rest is loaded with its real amount
    const rest = toMoney(theoretical).minus(toMoney('100000')).plus(toMoney('2300')).toFixed(2);
    const childNow = (await (await api.put(`/api/commitments/${child.id}/actual`, { actualAmount: rest })).json()) as CommitmentDetail;
    expect(childNow.deviation).toMatchObject({ amount: '2300.00' });
    expect(((await (await api.get(`/api/commitments/${original.id}`)).json()) as CommitmentDetail).deviation).toMatchObject({ amount: '2300.00' });

    const schedule = (await (await api.get(`/api/loans/${f.ids.loan}/schedule`)).json()) as LoanSchedule;
    const row = schedule.rows.find((r) => r.stored && r.stored.status !== 'paid')!;
    const realTotal = toMoney(theoretical).plus(toMoney('2300')).toFixed(2);
    expect(row.stored).toMatchObject({ actualAmount: realTotal, deviation: { amount: '2300.00' }, status: 'partially_paid' });

    [report] = (await (await api.get('/api/reports/loans')).json()) as LoanReport[];
    expect(report!.deviations).toEqual([expect.objectContaining({ actual: realTotal, amount: '2300.00' })]);
    expect(report!.deviationTotal).toBe('2300.00');
  });
});
