import type { CardStatement, CardTransaction, FinancialCostRow } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

let f: Fixtures;
let api: Client;
let statement: CardStatement;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
  api = await createHttpClient(f.t);
  statement = (await (
    await api.post('/api/card-statements', {
      creditCardId: f.ids.card,
      closingDate: '2026-09-25',
      dueDate: '2026-10-08',
      previousBalanceLocal: '175000',
      previousBalanceUsd: '0',
      totalLocal: '512345.67',
      totalUsd: '10',
      minimumPaymentLocal: '50000',
    })
  ).json()) as CardStatement;
});

afterEach(async () => {
  await f.t.close();
});

const line = (overrides: Record<string, unknown>) => ({
  kind: 'purchase',
  date: '2026-09-10',
  description: 'Super',
  categoryId: null,
  currency: 'ARS',
  amount: '1000',
  installmentPurchaseId: null,
  installmentNumber: null,
  subscriptionId: null,
  ...overrides,
});
const add = (overrides: Record<string, unknown>) => api.post(`/api/card-statements/${statement.id}/transactions`, line(overrides));

describe('statement breakdown (RF-12)', () => {
  it('adds lines of every kind, payments negative, an installment linked to its purchase', async () => {
    const [purchase] = await f.t.db.select().from(schema.installmentPurchase);
    expect((await add({})).status).toBe(201);
    expect((await add({ kind: 'payment', description: 'Su pago', amount: '-300000' })).status).toBe(201);
    const inst = (await (await add({ kind: 'installment', description: 'Heladera 2/6', amount: '100000', installmentPurchaseId: purchase!.id, installmentNumber: 2 })).json()) as CardTransaction;
    expect(inst).toMatchObject({ installmentPurchaseId: purchase!.id, installmentNumber: 2 });
    const list = (await (await api.get(`/api/card-statements/${statement.id}/transactions`)).json()) as CardTransaction[];
    expect(list.map((l) => [l.kind, l.amount])).toEqual([
      ['purchase', '1000.00'],
      ['payment', '-300000.00'],
      ['installment', '100000.00'],
    ]);
    // a purchase loaded by mistake can be removed
    expect((await api.delete(`/api/card-statements/${statement.id}/transactions/${list[0]!.id}`)).status).toBe(204);
  });

  it('checks the currency, the linked purchase and its installment number', async () => {
    const [purchase] = await f.t.db.select().from(schema.installmentPurchase);
    expect(await (await add({ currency: 'UYU' })).json()).toEqual({ error: 'conflict', reason: 'card_currency' });
    expect(await (await add({ kind: 'installment', installmentPurchaseId: purchase!.id, installmentNumber: 9 })).json()).toEqual({
      error: 'conflict',
      reason: 'installment_number',
    });
    const bad = await add({ installmentPurchaseId: purchase!.id, installmentNumber: null, amount: '1,5' });
    expect(((await bad.json()) as { fields: Record<string, string> }).fields).toEqual({ amount: 'decimal', installmentNumber: 'required' });
  });
});

describe('financial cost of the cards (rule 4, report)', () => {
  it('interest + admin fees + taxes per card, month and currency, with the ARS total at the due date rate', async () => {
    await add({ kind: 'interest', description: 'Intereses de financiación', amount: '18450.20' });
    await add({ kind: 'tax', description: 'IVA intereses', amount: '3874.54' });
    await add({ kind: 'admin_fee', description: 'Comisión mantenimiento', amount: '2500' });
    await add({ kind: 'tax', description: 'Impuesto de sellos', currency: 'USD', amount: '0.50' });
    await add({ kind: 'purchase', description: 'Not a cost', amount: '99999' });

    const rows = (await (await api.get('/api/reports/financial-cost?from=2026-10-01&to=2026-10-01')).json()) as FinancialCostRow[];
    const [card] = await f.t.db.select().from(schema.creditCard).where(eq(schema.creditCard.id, f.ids.card!));
    expect(rows).toEqual([
      { creditCardId: f.ids.card, cardName: card!.name, period: '2026-10-01', currency: 'ARS', interest: '18450.20', adminFee: '2500.00', tax: '3874.54', total: '24824.74', totalArs: '24824.74' },
      { creditCardId: f.ids.card, cardName: card!.name, period: '2026-10-01', currency: 'USD', interest: '0.00', adminFee: '0.00', tax: '0.50', total: '0.50', totalArs: '725.00' },
    ]);
    expect(await (await api.get('/api/reports/financial-cost?from=2026-11-01')).json()).toEqual([]);
  });
});
