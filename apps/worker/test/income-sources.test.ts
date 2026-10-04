import type { Category, IncomeSource, Person, Property } from '@meta31/contracts';
import { schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateForPeriod, toPeriod } from '@meta31/domain';
import { loadRules } from '../src/services/rules.js';
import { type Client, createHttpClient } from './http.js';

let t: TestDb;
let api: Client;
let salaries: Category;
let expenses: Category;

beforeEach(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  api = await createHttpClient(t);
  salaries = (await (await api.post('/api/categories', { name: 'Sueldos', kind: 'income' })).json()) as Category;
  expenses = (await (await api.post('/api/categories', { name: 'Casa', kind: 'expense' })).json()) as Category;
});

afterEach(async () => {
  await t.close();
});

const salaryInput = () => ({
  name: 'Sueldo docente',
  categoryId: salaries.id,
  holderId: null,
  propertyId: null,
  currency: 'ARS',
  everyMonths: 1,
  anchorMonth: 1,
  expectedDay: 5,
  validFrom: '2026-10-01',
  validTo: null,
  amount: '1500000',
});

async function createSalary(overrides: Record<string, unknown> = {}): Promise<IncomeSource> {
  const res = await api.post('/api/income-sources', { ...salaryInput(), ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as IncomeSource;
}

describe('people API', () => {
  it('lists users first, for the holder picker', async () => {
    const people = (await (await api.get('/api/people')).json()) as Person[];
    expect(people.map((p) => [p.name, p.isUser])).toEqual([
      ['Martín', true],
      ['Rosalía', true],
      ['Amaia', false],
    ]);
  });
});

describe('properties API (RF-26)', () => {
  it('creates, edits and deactivates; active ones listed first', async () => {
    const res = await api.post('/api/properties', { name: 'Pocitos', country: 'UY', currency: 'USD' });
    expect(res.status).toBe(201);
    const pocitos = (await res.json()) as Property;
    expect(pocitos).toMatchObject({ name: 'Pocitos', country: 'UY', currency: 'USD', active: true });
    await api.post('/api/properties', { name: 'Casa La Plata', country: 'AR', currency: 'ARS' });

    const edited = await api.patch(`/api/properties/${pocitos.id}`, { name: 'Depto Pocitos', active: false });
    expect(edited.status).toBe(200);
    const list = (await (await api.get('/api/properties')).json()) as Property[];
    expect(list.map((p) => [p.name, p.active])).toEqual([
      ['Casa La Plata', true],
      ['Depto Pocitos', false],
    ]);
  });

  it('validates the country and the currency; 404 for an unknown id', async () => {
    const res = await api.post('/api/properties', { name: 'X', country: 'BR', currency: 'BRL' });
    expect(res.status).toBe(400);
    expect(Object.keys(((await res.json()) as { fields: object }).fields).sort()).toEqual(['country', 'currency']);
    expect((await api.patch('/api/properties/00000000-0000-4000-8000-000000000000', { active: false })).status).toBe(404);
  });
});

describe('income sources API (RF-07, rule 7)', () => {
  it('creates a source with its first amount in force from validFrom, with audit columns', async () => {
    const created = await createSalary();
    expect(created).toMatchObject({ name: 'Sueldo docente', currency: 'ARS', expectedDay: 5, validTo: null });
    expect(created.amounts).toEqual([expect.objectContaining({ fromPeriod: '2026-10-01', amount: '1500000.00' })]);
    const [row] = await t.db.select().from(schema.incomeSource).where(eq(schema.incomeSource.id, created.id));
    expect(row!.createdBy).not.toBeNull();
    expect(row!.entryMode).toBe('manual');
  });

  it('links a rent to its property and a holder', async () => {
    const [martin] = (await (await api.get('/api/people')).json()) as Person[];
    const house = (await (await api.post('/api/properties', { name: 'Pocitos', country: 'UY', currency: 'UYU' })).json()) as Property;
    const rent = await createSalary({ name: 'Alquiler Pocitos', currency: 'UYU', holderId: martin!.id, propertyId: house.id });
    expect(rent).toMatchObject({ holderId: martin!.id, propertyId: house.id, currency: 'UYU' });
  });

  it('only accepts an income category and existing references', async () => {
    const wrongKind = await api.post('/api/income-sources', { ...salaryInput(), categoryId: expenses.id });
    expect(wrongKind.status).toBe(409);
    expect(await wrongKind.json()).toEqual({ error: 'conflict', reason: 'category_kind' });
    const missing = await api.post('/api/income-sources', { ...salaryInput(), propertyId: '00000000-0000-4000-8000-000000000000' });
    expect(await missing.json()).toEqual({ error: 'conflict', reason: 'invalid_reference' });
  });

  it('validates periodicity, days, months, amount and range, field by field', async () => {
    const res = await api.post('/api/income-sources', {
      ...salaryInput(),
      everyMonths: 4,
      anchorMonth: 13,
      expectedDay: 32,
      validFrom: '2026-10-15',
      amount: '0',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({
      everyMonths: 'choice',
      anchorMonth: 'choice',
      expectedDay: 'day',
      validFrom: 'period',
      amount: 'must_be_positive',
    });
    const range = await api.post('/api/income-sources', { ...salaryInput(), validTo: '2026-09-01' });
    expect(((await range.json()) as { fields: Record<string, string> }).fields).toEqual({ validTo: 'range' });
  });

  it('ends a source with validTo and checks it against validFrom', async () => {
    const created = await createSalary();
    const ended = await api.patch(`/api/income-sources/${created.id}`, { validTo: '2027-03-01' });
    expect(ended.status).toBe(200);
    expect(await ended.json()).toMatchObject({ validTo: '2027-03-01' });
    const before = await api.patch(`/api/income-sources/${created.id}`, { validTo: '2026-09-01' });
    expect(await before.json()).toEqual({ error: 'conflict', reason: 'valid_to_before_valid_from' });
    expect((await api.patch(`/api/income-sources/${created.id}`, { validTo: null })).status).toBe(200);
  });

  it('keeps the amount history; the projection uses each amount from its month on', async () => {
    const created = await createSalary();
    const res = await api.post(`/api/income-sources/${created.id}/amounts`, { fromPeriod: '2027-01-01', amount: '1800000' });
    expect(res.status).toBe(201);
    const updated = (await res.json()) as IncomeSource;
    expect(updated.amounts.map((a) => [a.fromPeriod, a.amount])).toEqual([
      ['2026-10-01', '1500000.00'],
      ['2027-01-01', '1800000.00'],
    ]);
    const rules = await loadRules(t.db);
    const amountIn = (p: string) => generateForPeriod(rules, toPeriod(p)).incomes[0]!.estimatedAmount.toFixed(2);
    expect(amountIn('2026-12-01')).toBe('1500000.00');
    expect(amountIn('2027-01-01')).toBe('1800000.00');

    const dup = await api.post(`/api/income-sources/${created.id}/amounts`, { fromPeriod: '2027-01-01', amount: '1' });
    expect(await dup.json()).toEqual({ error: 'conflict', reason: 'duplicate_period' });
  });

  it('corrects an amount, but never leaves the first month without one', async () => {
    const created = await createSalary();
    const first = created.amounts[0]!;
    const fixed = await api.patch(`/api/income-sources/${created.id}/amounts/${first.id}`, { amount: '1550000.50' });
    expect(((await fixed.json()) as IncomeSource).amounts[0]!.amount).toBe('1550000.50');

    const later = await api.patch(`/api/income-sources/${created.id}/amounts/${first.id}`, { fromPeriod: '2026-11-01' });
    expect(await later.json()).toEqual({ error: 'conflict', reason: 'no_amount_at_start' });
    const earlierStart = await api.patch(`/api/income-sources/${created.id}`, { validFrom: '2026-08-01' });
    expect(await earlierStart.json()).toEqual({ error: 'conflict', reason: 'no_amount_at_start' });

    const other = '00000000-0000-4000-8000-000000000000';
    expect((await api.patch(`/api/income-sources/${created.id}/amounts/${other}`, { amount: '1' })).status).toBe(404);
  });
});
