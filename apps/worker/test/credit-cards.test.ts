import type { CreditCard, Person } from '@meta31/contracts';
import { schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { generateForPeriod, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRules } from '../src/services/rules.js';
import { type Client, createHttpClient } from './http.js';

let t: TestDb;
let api: Client;
let martin: Person;

beforeEach(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  api = await createHttpClient(t);
  martin = ((await (await api.get('/api/people')).json()) as Person[]).find((p) => p.name === 'Martín')!;
});

afterEach(async () => {
  await t.close();
});

const visaInput = () => ({
  name: 'Visa Martín',
  bank: 'Provincia',
  country: 'AR',
  holderId: martin.id,
  closingDay: 25,
  dueDay: 8,
  estimatedSpendLocal: '300000',
  estimatedSpendUsd: '50',
});

async function create(overrides: Record<string, unknown> = {}): Promise<CreditCard> {
  const res = await api.post('/api/credit-cards', { ...visaInput(), ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as CreditCard;
}

describe('credit cards API (RF-10)', () => {
  it('the payment currency follows the country (rule 3)', async () => {
    const visa = await create();
    expect(visa).toMatchObject({ country: 'AR', localCurrency: 'ARS', estimatedSpendLocal: '300000.00', active: true });
    const uy = await create({ name: 'Visa Uruguay', bank: 'Itaú', country: 'UY' });
    expect(uy.localCurrency).toBe('UYU');
    const [row] = await t.db.select().from(schema.creditCard).where(eq(schema.creditCard.id, visa.id));
    expect(row!.createdBy).not.toBeNull();

    const moved = await api.patch(`/api/credit-cards/${visa.id}`, { country: 'UY' });
    expect(await moved.json()).toMatchObject({ country: 'UY', localCurrency: 'UYU' });
  });

  it('a future month gets two commitments, local and USD, from the estimated spend (D4, RF-16)', async () => {
    await create();
    const rules = await loadRules(t.db);
    const commitments = generateForPeriod(rules, toPeriod('2026-12-01')).commitments;
    expect(commitments.map((c) => [c.currency, c.estimatedAmount.toFixed(2)]).sort()).toEqual([
      ['ARS', '300000.00'],
      ['USD', '50.00'],
    ]);
  });

  it('validates days, amounts, country and the holder', async () => {
    const res = await api.post('/api/credit-cards', {
      ...visaInput(),
      country: 'BR',
      holderId: null,
      closingDay: 0,
      dueDay: 32,
      estimatedSpendLocal: '',
      estimatedSpendUsd: '-1',
    });
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({
      country: 'choice',
      holderId: 'default',
      closingDay: 'day',
      dueDay: 'day',
      estimatedSpendLocal: 'required',
      estimatedSpendUsd: 'decimal',
    });
    const ghost = await api.post('/api/credit-cards', { ...visaInput(), holderId: '00000000-0000-4000-8000-000000000000' });
    expect(await ghost.json()).toEqual({ error: 'conflict', reason: 'invalid_reference' });
  });

  it('deactivates instead of deleting; an inactive card is no longer projected', async () => {
    const visa = await create();
    const res = await api.patch(`/api/credit-cards/${visa.id}`, { active: false });
    expect(await res.json()).toMatchObject({ active: false });
    const rules = await loadRules(t.db);
    expect(generateForPeriod(rules, toPeriod('2026-12-01')).commitments).toEqual([]);
    expect((await api.patch('/api/credit-cards/00000000-0000-4000-8000-000000000000', { active: true })).status).toBe(404);
  });
});
