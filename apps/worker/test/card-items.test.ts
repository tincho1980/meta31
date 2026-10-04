import type { Category, CreditCard, InstallmentPurchase, Person, Subscription } from '@meta31/contracts';
import { schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { addMonths, currentPeriod, generateForPeriod, toPeriod } from '@meta31/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRules } from '../src/services/rules.js';
import { type Client, createHttpClient } from './http.js';

let t: TestDb;
let api: Client;
let visa: CreditCard;
let house: Category;

beforeEach(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  api = await createHttpClient(t);
  const martin = ((await (await api.get('/api/people')).json()) as Person[])[0]!;
  house = (await (await api.post('/api/categories', { name: 'Casa', kind: 'expense' })).json()) as Category;
  visa = (await (
    await api.post('/api/credit-cards', {
      name: 'Visa',
      bank: 'Provincia',
      country: 'AR',
      holderId: martin.id,
      closingDay: 25,
      dueDay: 8,
      estimatedSpendLocal: '0',
      estimatedSpendUsd: '0',
    })
  ).json()) as CreditCard;
});

afterEach(async () => {
  await t.close();
});

const fridge = () => ({
  creditCardId: visa.id,
  description: 'Heladera',
  categoryId: house.id,
  purchaseDate: '2026-08-15',
  currency: 'ARS',
  installmentAmount: '100000',
  installmentsTotal: 6,
  firstPeriod: '2026-09-01',
});

const netflix = () => ({
  creditCardId: visa.id,
  description: 'Netflix',
  categoryId: house.id,
  currency: 'USD',
  amount: '12.99',
  validFrom: '2026-01-10',
  validTo: null,
});

/** Card commitments of a month: [currency, amount]. */
const cardIn = async (period: string) =>
  generateForPeriod(await loadRules(t.db), toPeriod(period))
    .commitments.map((c) => [c.currency, c.estimatedAmount.toFixed(2)])
    .sort();

describe('installment purchases API (RF-13)', () => {
  it('creates a purchase with its last month; the installments are projected until the last one (rule 11)', async () => {
    const res = await api.post('/api/installment-purchases', fridge());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ installmentAmount: '100000.00', lastPeriod: '2027-02-01' });
    expect(await cardIn('2027-02-01')).toEqual([['ARS', '100000.00']]);
    expect(await cardIn('2027-03-01')).toEqual([]);
  });

  it('reports the installment of the current statement (RNF-15: "4 de 12" → first month three months back)', async () => {
    const first = addMonths(currentPeriod(), -3);
    const res = await api.post('/api/installment-purchases', { ...fridge(), installmentsTotal: 12, firstPeriod: first });
    expect(((await res.json()) as InstallmentPurchase).currentInstallment).toBe(4);
  });

  it('only in the card local currency or USD (D4), with an expense category that is not the card payment one', async () => {
    const uyu = await api.post('/api/installment-purchases', { ...fridge(), currency: 'UYU' });
    expect(await uyu.json()).toEqual({ error: 'conflict', reason: 'card_currency' });
    expect((await api.post('/api/installment-purchases', { ...fridge(), currency: 'USD' })).status).toBe(201);
    const cards = ((await (await api.get('/api/categories')).json()) as Category[]).find((c) => c.name === 'Tarjetas de crédito')!;
    const card = await api.post('/api/installment-purchases', { ...fridge(), categoryId: cards.id });
    expect(await card.json()).toEqual({ error: 'conflict', reason: 'card_payment_category' });
    const ghost = await api.post('/api/installment-purchases', { ...fridge(), creditCardId: '00000000-0000-4000-8000-000000000000' });
    expect(await ghost.json()).toEqual({ error: 'conflict', reason: 'invalid_reference' });
  });

  it('validates and lists by card; edits and deletes while no statement lists it', async () => {
    const bad = await api.post('/api/installment-purchases', { ...fridge(), installmentsTotal: 0, firstPeriod: '2026-09-15', installmentAmount: '0' });
    expect(((await bad.json()) as { fields: Record<string, string> }).fields).toEqual({
      installmentsTotal: 'installments',
      firstPeriod: 'period',
      installmentAmount: 'must_be_positive',
    });
    const created = (await (await api.post('/api/installment-purchases', fridge())).json()) as InstallmentPurchase;
    const list = (await (await api.get(`/api/installment-purchases?creditCardId=${visa.id}`)).json()) as InstallmentPurchase[];
    expect(list.map((p) => p.id)).toEqual([created.id]);
    const edited = await api.patch(`/api/installment-purchases/${created.id}`, { installmentsTotal: 3 });
    expect(await edited.json()).toMatchObject({ lastPeriod: '2026-11-01' });
    expect((await api.delete(`/api/installment-purchases/${created.id}`)).status).toBe(204);
  });

  it('cannot be deleted once a real statement lists one of its installments', async () => {
    const created = (await (await api.post('/api/installment-purchases', fridge())).json()) as InstallmentPurchase;
    const [statement] = await t.db
      .insert(schema.cardStatement)
      .values({ creditCardId: visa.id, period: '2026-10-01', closingDate: '2026-09-25', dueDate: '2026-10-08', totalLocal: '100000', totalUsd: '0', minimumPaymentLocal: '10000' })
      .returning();
    await t.db.insert(schema.cardTransaction).values({
      cardStatementId: statement!.id,
      kind: 'installment',
      description: 'Heladera 2/6',
      currency: 'ARS',
      amount: '100000',
      installmentPurchaseId: created.id,
      installmentNumber: 2,
    });
    const res = await api.delete(`/api/installment-purchases/${created.id}`);
    expect(await res.json()).toEqual({ error: 'conflict', reason: 'in_statement' });
  });
});

describe('subscriptions API (RF-14)', () => {
  it('is projected every month until it is cancelled', async () => {
    const res = await api.post('/api/subscriptions', netflix());
    expect(res.status).toBe(201);
    const sub = (await res.json()) as Subscription;
    expect(await cardIn('2027-05-01')).toEqual([['USD', '12.99']]);

    const cancelled = await api.patch(`/api/subscriptions/${sub.id}`, { validTo: '2026-12-15', amount: '13.99' });
    expect(await cancelled.json()).toMatchObject({ validTo: '2026-12-15', amount: '13.99' });
    expect(await cardIn('2026-12-01')).toEqual([['USD', '13.99']]);
    expect(await cardIn('2027-01-01')).toEqual([]);
  });

  it('checks the cancellation against the start, and the currency against the card', async () => {
    const range = await api.post('/api/subscriptions', { ...netflix(), validTo: '2025-12-31' });
    expect(((await range.json()) as { fields: Record<string, string> }).fields).toEqual({ validTo: 'range' });
    const sub = (await (await api.post('/api/subscriptions', netflix())).json()) as Subscription;
    const before = await api.patch(`/api/subscriptions/${sub.id}`, { validTo: '2025-12-31' });
    expect(await before.json()).toEqual({ error: 'conflict', reason: 'valid_to_before_valid_from' });
    const uyu = await api.patch(`/api/subscriptions/${sub.id}`, { currency: 'UYU' });
    expect(await uyu.json()).toEqual({ error: 'conflict', reason: 'card_currency' });
  });

  it('lists active ones first and deletes one loaded by mistake', async () => {
    const old = (await (await api.post('/api/subscriptions', { ...netflix(), description: 'Spotify', validTo: '2026-03-01' })).json()) as Subscription;
    await api.post('/api/subscriptions', netflix());
    const list = (await (await api.get('/api/subscriptions')).json()) as Subscription[];
    expect(list.map((s) => s.description)).toEqual(['Netflix', 'Spotify']);
    expect((await api.delete(`/api/subscriptions/${old.id}`)).status).toBe(204);
  });
});
