import type { Category, Person, Property, RecurringExpense } from '@meta31/contracts';
import { schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { generateForPeriod, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const powerInput = () => ({
  name: 'Luz',
  class: 'utility',
  provider: 'Edelap',
  categoryId: house.id,
  propertyId: null,
  beneficiaryId: null,
  currency: 'ARS',
  everyMonths: 1,
  anchorMonth: 1,
  dueDay: 20,
  validFrom: '2026-10-01',
  validTo: null,
  amount: '45000',
});

async function create(overrides: Record<string, unknown> = {}): Promise<RecurringExpense> {
  const res = await api.post('/api/recurring-expenses', { ...powerInput(), ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as RecurringExpense;
}

const categories = async () => (await (await api.get('/api/categories')).json()) as Category[];

describe('recurring expenses API (RF-17, RF-18, RF-20, D2)', () => {
  it('creates a utility with provider, property and its first estimated amount', async () => {
    const property = (await (await api.post('/api/properties', { name: 'La Plata', country: 'AR', currency: 'ARS' })).json()) as Property;
    const power = await create({ propertyId: property.id });
    expect(power).toMatchObject({ name: 'Luz', class: 'utility', provider: 'Edelap', propertyId: property.id, dueDay: 20 });
    expect(power.amounts).toEqual([expect.objectContaining({ fromPeriod: '2026-10-01', amount: '45000.00' })]);
    const [row] = await t.db.select().from(schema.recurringExpense).where(eq(schema.recurringExpense.id, power.id));
    expect(row!.createdBy).not.toBeNull();
  });

  it('a yearly tax generates a single commitment, in its payment month (rule 8)', async () => {
    await create({ name: 'ARBA', class: 'tax', provider: null, everyMonths: 12, anchorMonth: 3, dueDay: null, amount: '480000' });
    const rules = await loadRules(t.db);
    const months = ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01'];
    const withTax = months.filter((p) => generateForPeriod(rules, toPeriod(p)).commitments.length > 0);
    expect(withTax).toEqual(['2027-03-01']);
  });

  it('an allowance with a beneficiary and an end month stops being projected after it (rule 11)', async () => {
    const amaia = ((await (await api.get('/api/people')).json()) as Person[]).find((p) => p.name === 'Amaia')!;
    await create({ name: 'Mesada', class: 'recurring', provider: null, beneficiaryId: amaia.id, validTo: '2026-12-01' });
    const rules = await loadRules(t.db);
    expect(generateForPeriod(rules, toPeriod('2026-12-01')).commitments).toHaveLength(1);
    expect(generateForPeriod(rules, toPeriod('2027-01-01')).commitments).toHaveLength(0);
  });

  it('rejects an income category and the card payment category (rule 1)', async () => {
    const all = await categories();
    const rents = all.find((c) => c.name === 'Alquileres')!;
    const cards = all.find((c) => c.name === 'Tarjetas de crédito')!;
    const income = await api.post('/api/recurring-expenses', { ...powerInput(), categoryId: rents.id });
    expect(await income.json()).toEqual({ error: 'conflict', reason: 'category_kind' });
    const card = await api.post('/api/recurring-expenses', { ...powerInput(), categoryId: cards.id });
    expect(await card.json()).toEqual({ error: 'conflict', reason: 'card_payment_category' });
  });

  it('validates class, provider, day and range', async () => {
    const res = await api.post('/api/recurring-expenses', {
      ...powerInput(),
      class: 'gift',
      provider: '   ',
      dueDay: 0,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({
      class: 'choice',
      provider: 'required',
      dueDay: 'day',
    });
    // the cross-field check runs once the fields themselves are valid
    const range = await api.post('/api/recurring-expenses', { ...powerInput(), validTo: '2026-01-01' });
    expect(((await range.json()) as { fields: Record<string, string> }).fields).toEqual({ validTo: 'range' });
  });

  it('keeps the estimated amount history and edits the expense', async () => {
    const power = await create();
    const res = await api.post(`/api/recurring-expenses/${power.id}/amounts`, { fromPeriod: '2027-01-01', amount: '52000' });
    expect(((await res.json()) as RecurringExpense).amounts.map((a) => a.amount)).toEqual(['45000.00', '52000.00']);
    const rules = await loadRules(t.db);
    expect(generateForPeriod(rules, toPeriod('2027-01-01')).commitments[0]!.estimatedAmount.toFixed(2)).toBe('52000.00');

    const edited = await api.patch(`/api/recurring-expenses/${power.id}`, { provider: null, validTo: '2027-06-01' });
    expect(await edited.json()).toMatchObject({ provider: null, validTo: '2027-06-01' });
    const first = power.amounts[0]!;
    const later = await api.patch(`/api/recurring-expenses/${power.id}/amounts/${first.id}`, { fromPeriod: '2027-02-01' });
    expect(await later.json()).toEqual({ error: 'conflict', reason: 'no_amount_at_start' });
  });
});
