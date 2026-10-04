import type { Category, OneOffExpense, Property } from '@meta31/contracts';
import { findUserByEmail, schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { generateForPeriod, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { loadRules } from '../src/services/rules.js';
import { type Client, createHttpClient } from './http.js';

let t: TestDb;
let api: Client;
let house: Category;

beforeEach(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  api = await createHttpClient(t);
  house = (await (await api.post('/api/categories', { name: 'Casa', kind: 'expense' })).json()) as Category;
});

afterEach(async () => {
  await t.close();
});

const boilerInput = () => ({
  description: 'Termotanque',
  categoryId: house.id,
  propertyId: null,
  currency: 'ARS',
  totalAmount: '1000000',
  installments: 3,
  firstPeriod: '2026-11-01',
  plannedDate: '2026-11-10',
});

async function create(overrides: Record<string, unknown> = {}): Promise<OneOffExpense> {
  const res = await api.post('/api/one-off-expenses', { ...boilerInput(), ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as OneOffExpense;
}

const estimatedIn = async (period: string) =>
  generateForPeriod(await loadRules(t.db), toPeriod(period)).commitments.map((c) => [c.description, c.estimatedAmount.toFixed(2)]);

describe('one-off expenses API (RF-21)', () => {
  it('creates it with the installment amount and the last month; the last installment absorbs the rounding', async () => {
    const boiler = await create();
    expect(boiler).toMatchObject({ totalAmount: '1000000.00', installments: 3, installmentAmount: '333333.33', lastPeriod: '2027-01-01' });
    expect(await estimatedIn('2026-11-01')).toEqual([['Termotanque (1/3)', '333333.33']]);
    expect(await estimatedIn('2027-01-01')).toEqual([['Termotanque (3/3)', '333333.34']]);
    expect(await estimatedIn('2027-02-01')).toEqual([]);
    const [row] = await t.db.select().from(schema.oneOffExpense).where(eq(schema.oneOffExpense.id, boiler.id));
    expect(row!.createdBy).not.toBeNull();
  });

  it('a single payment can be far in the future, with a property and no planned date', async () => {
    const property = (await (await api.post('/api/properties', { name: 'La Plata', country: 'AR', currency: 'ARS' })).json()) as Property;
    const roof = await create({ description: 'Techo', installments: 1, firstPeriod: '2027-08-01', plannedDate: null, propertyId: property.id });
    expect(roof).toMatchObject({ installmentAmount: '1000000.00', lastPeriod: '2027-08-01', propertyId: property.id });
    expect(await estimatedIn('2027-08-01')).toEqual([['Techo', '1000000.00']]);
  });

  it('the planned date falls in the first month', async () => {
    const res = await api.post('/api/one-off-expenses', { ...boilerInput(), plannedDate: '2026-12-05' });
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({ plannedDate: 'month_mismatch' });
    const boiler = await create();
    const moved = await api.patch(`/api/one-off-expenses/${boiler.id}`, { firstPeriod: '2026-12-01' });
    expect(await moved.json()).toEqual({ error: 'conflict', reason: 'planned_date_month' });
    const both = await api.patch(`/api/one-off-expenses/${boiler.id}`, { firstPeriod: '2026-12-01', plannedDate: '2026-12-05' });
    expect(both.status).toBe(200);
  });

  it('validates installments, amount and period', async () => {
    const res = await api.post('/api/one-off-expenses', {
      ...boilerInput(),
      installments: 0,
      totalAmount: '-5',
      firstPeriod: '2026-11-10',
      plannedDate: null,
    });
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({
      installments: 'installments',
      totalAmount: 'decimal',
      firstPeriod: 'period',
    });
    const tooMany = await api.post('/api/one-off-expenses', { ...boilerInput(), installments: 121 });
    expect(tooMany.status).toBe(400);
  });

  it('rejects the card payment category: paid by card it is an installment purchase (rule 1)', async () => {
    const cards = ((await (await api.get('/api/categories')).json()) as Category[]).find((c) => c.name === 'Tarjetas de crédito')!;
    const res = await api.post('/api/one-off-expenses', { ...boilerInput(), categoryId: cards.id });
    expect(await res.json()).toEqual({ error: 'conflict', reason: 'card_payment_category' });
  });

  it('editing changes the installments still virtual; stored ones keep their amount (D1)', async () => {
    const boiler = await create();
    const userId = (await findUserByEmail(t.db, 'martin@example.com'))!.id;
    await openMonth(t.db, toPeriod('2026-11-01'), userId);
    const edited = await api.patch(`/api/one-off-expenses/${boiler.id}`, { totalAmount: '1200000' });
    expect(await edited.json()).toMatchObject({ installmentAmount: '400000.00' });

    const stored = await t.db.select().from(schema.commitment).where(eq(schema.commitment.oneOffExpenseId, boiler.id));
    expect(stored.map((c) => c.estimatedAmount)).toEqual(['333333.33']);
    expect(await estimatedIn('2026-12-01')).toEqual([['Termotanque (2/3)', '400000.00']]);
  });

  it('deletes it while nothing is stored; once a month is opened it must be cancelled there', async () => {
    const mistake = await create({ description: 'Error de carga' });
    const res = await api.delete(`/api/one-off-expenses/${mistake.id}`);
    expect(res.status).toBe(204);
    expect((await (await api.get('/api/one-off-expenses')).json()) as OneOffExpense[]).toEqual([]);
    expect((await api.delete(`/api/one-off-expenses/${mistake.id}`)).status).toBe(404);

    const boiler = await create();
    const userId = (await findUserByEmail(t.db, 'martin@example.com'))!.id;
    await openMonth(t.db, toPeriod('2026-11-01'), userId);
    const stored = await api.delete(`/api/one-off-expenses/${boiler.id}`);
    expect(stored.status).toBe(409);
    expect(await stored.json()).toEqual({ error: 'conflict', reason: 'has_stored_commitments' });
  });
});
