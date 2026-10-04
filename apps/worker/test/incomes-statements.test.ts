import type { CardStatement, Category, MonthProjection, OneOffIncome } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { generateForPeriod, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { loadRules } from '../src/services/rules.js';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

let f: Fixtures;
let api: Client;
let extras: Category;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
  api = await createHttpClient(f.t);
  extras = (await (await api.post('/api/categories', { name: 'Extras', kind: 'income' })).json()) as Category;
});

afterEach(async () => {
  await f.t.close();
});

const project = async (period: string) =>
  ((await (await api.get(`/api/months/projection?from=${period}&months=1`)).json()) as MonthProjection[])[0]!;

describe('one-off incomes API (RF-09)', () => {
  const project_ = () => ({
    description: 'Proyecto Adavra',
    categoryId: extras.id,
    period: '2026-12-01',
    expectedDate: '2026-12-15',
    currency: 'USD',
    estimatedAmount: '800',
  });

  it('is stored as expected and counts in its month', async () => {
    const res = await api.post('/api/one-off-incomes', project_());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: 'expected', estimatedAmount: '800.00', actualAmount: null });
    const dec = await project('2026-12-01');
    expect(dec.incomes.find((l) => l.origin === 'one_off_income')).toMatchObject({ description: 'Proyecto Adavra', amount: '800.00', stored: true });
    expect(((await (await api.get('/api/one-off-incomes')).json()) as OneOffIncome[]).map((i) => i.description)).toEqual(['Proyecto Adavra']);
  });

  it('the date falls in its month; the category is an income one', async () => {
    const res = await api.post('/api/one-off-incomes', { ...project_(), expectedDate: '2027-01-02' });
    expect(((await res.json()) as { fields: Record<string, string> }).fields).toEqual({ expectedDate: 'month_mismatch' });
    const house = (await f.t.db.select().from(schema.category).where(eq(schema.category.name, 'Casa')))[0]!;
    const wrong = await api.post('/api/one-off-incomes', { ...project_(), categoryId: house.id });
    expect(await wrong.json()).toEqual({ error: 'conflict', reason: 'category_kind' });
    const created = (await (await api.post('/api/one-off-incomes', project_())).json()) as OneOffIncome;
    const moved = await api.patch(`/api/one-off-incomes/${created.id}`, { period: '2027-01-01' });
    expect(await moved.json()).toEqual({ error: 'conflict', reason: 'expected_date_month' });
  });

  it('edits and deletes while expected, but not once received', async () => {
    const created = (await (await api.post('/api/one-off-incomes', project_())).json()) as OneOffIncome;
    expect(await (await api.patch(`/api/one-off-incomes/${created.id}`, { estimatedAmount: '900' })).json()).toMatchObject({ estimatedAmount: '900.00' });
    await f.t.db.update(schema.income).set({ status: 'received', actualAmount: '900' }).where(eq(schema.income.id, created.id));
    expect(await (await api.delete(`/api/one-off-incomes/${created.id}`)).json()).toEqual({ error: 'conflict', reason: 'not_expected' });
    // income-source incomes are not one-offs
    await openMonth(f.t.db, toPeriod('2026-10-01'), f.userId);
    const [salary] = await f.t.db.select().from(schema.income).where(eq(schema.income.incomeSourceId, f.ids.salary!));
    expect((await api.patch(`/api/one-off-incomes/${salary!.id}`, { estimatedAmount: '1' })).status).toBe(404);
  });
});

describe('card statements API (RF-11, RF-16)', () => {
  const statement = (overrides: Record<string, unknown> = {}) => ({
    creditCardId: f.ids.card,
    closingDate: '2026-11-26',
    dueDate: '2026-12-09',
    previousBalanceLocal: '0',
    previousBalanceUsd: '0',
    totalLocal: '412345.67',
    totalUsd: '35.5',
    minimumPaymentLocal: '41000',
    ...overrides,
  });

  it('a real statement replaces the estimate of its month (the month of its due date)', async () => {
    const res = await api.post('/api/card-statements', statement());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ period: '2026-12-01', totalLocal: '412345.67' });
    const dec = generateForPeriod(await loadRules(f.t.db), toPeriod('2026-12-01')).commitments.filter((c) => c.origin.kind === 'credit_card');
    expect(dec.map((c) => [c.currency, c.estimatedAmount.toFixed(2), c.dueDate]).sort()).toEqual([
      ['ARS', '412345.67', '2026-12-09'],
      ['USD', '35.50', '2026-12-09'],
    ]);
  });

  it('in an opened month it updates the stored pending commitment and adds the missing currency', async () => {
    await openMonth(f.t.db, toPeriod('2026-10-01'), f.userId);
    const cardRows = () => f.t.db.select().from(schema.commitment).where(eq(schema.commitment.creditCardId, f.ids.card!));
    expect((await cardRows()).map((c) => c.currency)).toEqual(['ARS']);

    await api.post('/api/card-statements', statement({ closingDate: '2026-09-25', dueDate: '2026-10-08', totalLocal: '350000', totalUsd: '20' }));
    const rows = (await cardRows()).map((c) => [c.currency, c.estimatedAmount, c.dueDate]).sort();
    expect(rows).toEqual([
      ['ARS', '350000.00', '2026-10-08'],
      ['USD', '20.00', '2026-10-08'],
    ]);

    const [stmt] = (await (await api.get(`/api/card-statements?creditCardId=${f.ids.card}`)).json()) as CardStatement[];
    await api.patch(`/api/card-statements/${stmt!.id}`, { totalLocal: '351000' });
    expect((await cardRows()).find((c) => c.currency === 'ARS')!.estimatedAmount).toBe('351000.00');
  });

  it('one statement per card and month; it closes before it is due', async () => {
    await api.post('/api/card-statements', statement());
    expect(await (await api.post('/api/card-statements', statement())).json()).toEqual({ error: 'conflict', reason: 'duplicate_statement' });
    const bad = await api.post('/api/card-statements', statement({ closingDate: '2026-12-10' }));
    expect(((await bad.json()) as { fields: Record<string, string> }).fields).toEqual({ dueDate: 'range' });
    const [stmt] = (await (await api.get('/api/card-statements')).json()) as CardStatement[];
    const moved = await api.patch(`/api/card-statements/${stmt!.id}`, { dueDate: '2027-01-05' });
    expect(await moved.json()).toEqual({ error: 'conflict', reason: 'statement_month' });
  });
});
