import type { FutureCommitment, LoanReport, SpendingByCategory } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { addMonths, currentPeriod, toMoney, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

let f: Fixtures;
let api: Client;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2020-01-01', rate: '1450' });
  api = await createHttpClient(f.t);
});

afterEach(async () => {
  await f.t.close();
});

describe('loans report (RF-23, RF-25)', () => {
  it('lists each loan with its deviations from the schedule and their total', async () => {
    await openMonth(f.t.db, toPeriod('2026-10-01'), f.userId);
    const [loan] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.loanId, f.ids.loan!));
    const actual = toMoney(loan!.estimatedAmount).plus(toMoney('2300')).toFixed(2);
    await api.put(`/api/commitments/${loan!.id}/actual`, { actualAmount: actual });

    const [report] = (await (await api.get('/api/reports/loans')).json()) as LoanReport[];
    expect(report!.loan.id).toBe(f.ids.loan);
    expect(report!.deviations).toEqual([
      expect.objectContaining({ number: loan!.installmentNumber, theoretical: loan!.estimatedAmount, actual, amount: '2300.00' }),
    ]);
    expect(report!.deviationTotal).toBe('2300.00');
  });

  it('a split installment (paid in part, rest postponed) adds no deviation', async () => {
    await openMonth(f.t.db, toPeriod('2026-10-01'), f.userId);
    const [loan] = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.loanId, f.ids.loan!));
    await api.post(`/api/commitments/${loan!.id}/payments`, { date: '2026-10-20', paymentCurrency: 'ARS', amountPaid: '100000', paymentMethod: 'debit' });
    await api.post(`/api/commitments/${loan!.id}/postpone`, { dueDate: '2026-11-10' });
    const [report] = (await (await api.get('/api/reports/loans')).json()) as LoanReport[];
    expect(report).toMatchObject({ deviations: [], deviationTotal: '0.00' });
  });
});

describe('spending by category (report)', () => {
  it('sums the month in ARS per category, biggest first, adding up to the total', async () => {
    const res = (await (await api.get('/api/reports/spending-by-category?period=2026-10-01')).json()) as SpendingByCategory;
    expect(res.period).toBe('2026-10-01');
    const amounts = res.rows.map((r) => toMoney(r.amountArs));
    for (let i = 1; i < amounts.length; i++) expect(amounts[i - 1]!.gte(amounts[i]!)).toBe(true);
    expect(amounts.reduce((a, b) => a.plus(b), toMoney('0')).toFixed(2)).toBe(res.total);
    const cats = await f.t.db.select().from(schema.category);
    const name = (id: string) => cats.find((c) => c.id === id)!.name;
    expect(res.rows.map((r) => name(r.categoryId)).sort()).toEqual(['Casa', 'Préstamos', 'Tarjetas de crédito']);
  });
});

describe('future commitments by type (report)', () => {
  it('what is still running, what it takes each month and when it ends', async () => {
    const now = currentPeriod();
    const [cat] = await f.t.db.select().from(schema.category).where(eq(schema.category.name, 'Casa'));
    const [tv] = await f.t.db
      .insert(schema.installmentPurchase)
      .values({
        creditCardId: f.ids.card!,
        description: 'Tele',
        categoryId: cat!.id,
        purchaseDate: '2020-01-01',
        currency: 'ARS',
        installmentAmount: '50000',
        installmentsTotal: 6,
        firstPeriod: addMonths(now, -1), // installment 2 of 6 this month
      })
      .returning();
    await f.t.db.insert(schema.subscription).values({ creditCardId: f.ids.card!, description: 'Streaming', categoryId: cat!.id, currency: 'USD', amount: '12.99', validFrom: '2020-01-01' });
    await f.t.db.insert(schema.installmentPurchase).values({
      creditCardId: f.ids.card!,
      description: 'Ya terminada',
      categoryId: cat!.id,
      purchaseDate: '2020-01-01',
      currency: 'ARS',
      installmentAmount: '1',
      installmentsTotal: 1,
      firstPeriod: addMonths(now, -2),
    });

    const items = (await (await api.get('/api/reports/future-commitments')).json()) as FutureCommitment[];
    expect(items.find((i) => i.id === tv!.id)).toMatchObject({
      kind: 'installment_purchase',
      detail: 'Visa',
      monthlyAmount: '50000.00',
      lastPeriod: addMonths(now, 4),
      remaining: 5,
    });
    expect(items.find((i) => i.kind === 'subscription')).toMatchObject({ description: 'Streaming', currency: 'USD', lastPeriod: null, remaining: null });
    expect(items.some((i) => i.description === 'Ya terminada')).toBe(false);
  });
});
