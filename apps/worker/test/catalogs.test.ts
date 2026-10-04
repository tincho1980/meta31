import type { Category, ExchangeRate } from '@meta31/contracts';
import { schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Client, createHttpClient } from './http.js';

let t: TestDb;
let api: Client;

beforeEach(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  api = await createHttpClient(t);
});

afterEach(async () => {
  await t.close();
});

describe('categories API (RF-06)', () => {
  it('lists categories, flagging the system one', async () => {
    const res = await api.get('/api/categories');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ name: 'Tarjetas de crédito', kind: 'expense', active: true, system: true }),
    ]);
  });

  it('creates a category with audit columns and filters by kind', async () => {
    const res = await api.post('/api/categories', { name: '  Sueldos ', kind: 'income' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Category;
    expect(created).toMatchObject({ name: 'Sueldos', kind: 'income', active: true, system: false });
    const [row] = await t.db.select().from(schema.category).where(eq(schema.category.id, created.id));
    expect(row!.createdBy).not.toBeNull();
    const incomes = (await (await api.get('/api/categories?kind=income')).json()) as Category[];
    expect(incomes.map((c) => c.name)).toEqual(['Sueldos']);
  });

  it('rejects a duplicate name of the same kind with 409, but allows it for the other kind', async () => {
    await api.post('/api/categories', { name: 'Varios', kind: 'expense' });
    const dup = await api.post('/api/categories', { name: 'Varios', kind: 'expense' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: 'conflict', reason: 'duplicate_name' });
    expect((await api.post('/api/categories', { name: 'Varios', kind: 'income' })).status).toBe(201);
  });

  it('validates the input and says which field failed', async () => {
    const res = await api.post('/api/categories', { name: '   ', kind: 'gift' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe('validation_error');
    expect(Object.keys(body.fields).sort()).toEqual(['kind', 'name']);
  });

  it('renames and deactivates; never deletes', async () => {
    const created = (await (await api.post('/api/categories', { name: 'Nafta', kind: 'expense' })).json()) as Category;
    const res = await api.patch(`/api/categories/${created.id}`, { name: 'Combustible', active: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Combustible', active: false });
  });

  it('protects the card payment category from changes', async () => {
    const [system] = (await (await api.get('/api/categories')).json()) as Category[];
    const res = await api.patch(`/api/categories/${system!.id}`, { name: 'Otra' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', reason: 'system_category' });
  });

  it('404 for an unknown id, 400 for a malformed one or an empty update', async () => {
    expect((await api.patch('/api/categories/00000000-0000-4000-8000-000000000000', { active: false })).status).toBe(404);
    expect((await api.patch('/api/categories/not-a-uuid', { active: false })).status).toBe(400);
    const created = (await (await api.post('/api/categories', { name: 'X', kind: 'expense' })).json()) as Category;
    expect((await api.patch(`/api/categories/${created.id}`, {})).status).toBe(400);
  });
});

describe('exchange rates API (RF-04)', () => {
  it('loads rates, including backdated ones, listed newest first per pair', async () => {
    expect((await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-10-01', rate: '1450' })).status).toBe(201);
    expect((await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-09-15', rate: '1420.5' })).status).toBe(201);
    expect((await api.post('/api/exchange-rates', { pair: 'UYU_USD', validFrom: '2026-10-01', rate: '40.25' })).status).toBe(201);
    const list = (await (await api.get('/api/exchange-rates')).json()) as ExchangeRate[];
    expect(list.map((r) => [r.pair, r.validFrom, r.rate])).toEqual([
      ['USD_ARS', '2026-10-01', '1450.000000'],
      ['USD_ARS', '2026-09-15', '1420.500000'],
      ['UYU_USD', '2026-10-01', '40.250000'],
    ]);
    const uyu = (await (await api.get('/api/exchange-rates?pair=UYU_USD')).json()) as ExchangeRate[];
    expect(uyu).toHaveLength(1);
  });

  it('one rate per pair and date', async () => {
    await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-10-01', rate: '1450' });
    const dup = await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-10-01', rate: '1460' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: 'conflict', reason: 'duplicate_date' });
  });

  it('rejects zero, negative, non-numeric, too precise or a number instead of a string', async () => {
    for (const rate of ['0', '0.000000', '-1', 'abc', '1.1234567', 1450]) {
      const res = await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-10-01', rate });
      expect(res.status, `rate ${JSON.stringify(rate)}`).toBe(400);
    }
    const badDate = await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-02-30', rate: '1' });
    expect(badDate.status).toBe(400);
  });

  it('corrects a rate or its date', async () => {
    const created = (await (await api.post('/api/exchange-rates', { pair: 'USD_ARS', validFrom: '2026-10-01', rate: '1450' })).json()) as ExchangeRate;
    const res = await api.patch(`/api/exchange-rates/${created.id}`, { rate: '1455.75', validFrom: '2026-10-02' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rate: '1455.750000', validFrom: '2026-10-02' });
    expect((await api.patch('/api/exchange-rates/00000000-0000-4000-8000-000000000000', { rate: '1' })).status).toBe(404);
  });
});
