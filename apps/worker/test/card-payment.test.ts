import type { CommitmentDetail, MonthProjection } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { toMoney, toPeriod } from '@meta31/domain';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARRIED_INTO_STATEMENT } from '../src/services/card-statements.js';
import { openMonth } from '../src/services/open-month.js';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

let f: Fixtures;
let api: Client;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
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

const cardCommitment = async (currency: 'ARS' | 'USD', period = '2026-10-01') =>
  (
    await f.t.db
      .select()
      .from(schema.commitment)
      .where(and(eq(schema.commitment.creditCardId, f.ids.card!), eq(schema.commitment.currency, currency), eq(schema.commitment.period, period)))
  )[0];
const payCard = (body: Record<string, unknown>) =>
  api.post(`/api/credit-cards/${f.ids.card}/payments`, { period: '2026-10-01', date: '2026-10-08', paymentMethod: 'debit', ...body });

describe('card statement payment in two currencies (RF-15, rule 3)', () => {
  it('pays the peso part and the USD part in pesos in one go, with the applied rate', async () => {
    const ars = (await cardCommitment('ARS'))!;
    const res = await payCard({ localAmount: ars.estimatedAmount, usdPartAmount: '29000' });
    expect(res.status).toBe(201);
    const [local, usd] = (await res.json()) as CommitmentDetail[];
    expect(local).toMatchObject({ currency: 'ARS', status: 'paid' });
    expect(usd).toMatchObject({ currency: 'USD', status: 'paid', paid: '20.00' });
    expect(usd!.payments[0]).toMatchObject({ paymentCurrency: 'ARS', amountPaid: '29000.00', appliedRate: '1450.000000' });
  });

  it('only the USD part, at the bank rate', async () => {
    const [usd] = (await (await payCard({ usdPartAmount: '15300', appliedRate: '1530' })).json()) as CommitmentDetail[];
    expect(usd).toMatchObject({ status: 'partially_paid', paid: '10.00' });
  });

  it('needs an opened month and at least one amount', async () => {
    expect(await (await payCard({ period: '2026-12-01', localAmount: '1000' })).json()).toEqual({ error: 'conflict', reason: 'not_open' });
    expect(((await (await payCard({})).json()) as { fields: Record<string, string> }).fields).toEqual({ localAmount: 'required' });
  });
});

describe('partial card payment: the rest goes to the next statement (rule 4)', () => {
  it('the rest carried to November counts there until November\'s real statement, which already includes it', async () => {
    const ars = (await cardCommitment('ARS'))!;
    await payCard({ localAmount: '100000' });
    const child = (await (await api.post(`/api/commitments/${ars.id}/postpone`, { dueDate: '2026-11-08' })).json()) as CommitmentDetail;
    const rest = toMoney(ars.estimatedAmount).minus(toMoney('100000')).toFixed(2);
    expect(child).toMatchObject({ period: '2026-11-01', amountInForce: rest });

    const nov = async () => ((await (await api.get('/api/months/projection?from=2026-11-01&months=1')).json()) as MonthProjection[])[0]!;
    expect((await nov()).commitments.some((l) => l.id === child.id)).toBe(true);

    await api.post('/api/card-statements', {
      creditCardId: f.ids.card,
      closingDate: '2026-10-26',
      dueDate: '2026-11-08',
      previousBalanceLocal: rest,
      previousBalanceUsd: '0',
      totalLocal: '700000',
      totalUsd: '20',
      minimumPaymentLocal: '70000',
    });
    const [cancelled] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.id, child.id));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellationReason: CARRIED_INTO_STATEMENT });
    const card = (await nov()).commitments.filter((l) => l.origin === 'credit_card').map((l) => [l.currency, l.amount]).sort();
    expect(card).toEqual([
      ['ARS', '700000.00'],
      ['USD', '20.00'],
    ]);
  });
});
