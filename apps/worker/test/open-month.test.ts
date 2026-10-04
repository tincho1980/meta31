import { cardPaymentCategoryId, schema } from '@meta31/db';
import type { TestDb } from '@meta31/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { createFixtures, OCT } from './fixtures.js';

const { category, commitment, income, incomeSourceAmount, month } = schema;

let t: TestDb;
let userId: string;
let ids: Record<string, string>;

beforeEach(async () => {
  ({ t, userId, ids } = await createFixtures());
});

afterEach(async () => {
  await t.close();
});

const storedCommitments = () =>
  t.db
    .select({ sourceKey: commitment.sourceKey, period: commitment.period, amount: commitment.estimatedAmount, status: commitment.status })
    .from(commitment)
    .orderBy(commitment.sourceKey);

describe('open month (RF-27, D1)', () => {
  it('materializes every commitment and income the rules generate for the month', async () => {
    const result = await openMonth(t.db, OCT, userId);
    expect(result).toMatchObject({ status: 'opened', commitments: 3, incomes: 1, issues: [] });

    expect(await storedCommitments()).toEqual([
      { sourceKey: `cc:${ids.card}:2026-10-01:ARS`, period: '2026-10-01', amount: '400000.00', status: 'pending' },
      { sourceKey: `ln:${ids.loan}:7`, period: '2026-10-01', amount: '213955.04', status: 'pending' },
      { sourceKey: `re:${ids.power}:2026-10-01`, period: '2026-10-01', amount: '45000.00', status: 'pending' },
    ]);
    // the yearly tax is due in March: nothing in October (rule 8)
    const incomes = await t.db.select().from(income);
    expect(incomes.map((i) => [i.sourceKey, i.estimatedAmount, i.expectedDate, i.status])).toEqual([
      [`is:${ids.salary}:2026-10-01`, '1500000.00', '2026-10-05', 'expected'],
    ]);
  });

  it('records who opened it and the audit columns', async () => {
    await openMonth(t.db, OCT, userId);
    const [m] = await t.db.select().from(month);
    expect([m!.period, m!.status, m!.openedBy]).toEqual(['2026-10-01', 'open', userId]);
    const rows = await t.db.select().from(commitment);
    expect(rows.every((r) => r.createdBy === userId && r.entryMode === 'manual' && r.originPeriod === r.period)).toBe(true);
  });

  it('opening twice does not duplicate anything', async () => {
    await openMonth(t.db, OCT, userId);
    expect(await openMonth(t.db, OCT, userId)).toEqual({ status: 'already_open' });
    expect(await storedCommitments()).toHaveLength(3);
    expect(await t.db.select().from(income)).toHaveLength(1);
  });

  it('two users opening at the same time do not duplicate anything', async () => {
    const results = await Promise.all([openMonth(t.db, OCT, userId), openMonth(t.db, OCT, userId)]);
    expect(results.map((r) => r.status).sort()).toEqual(['already_open', 'opened']);
    expect(await storedCommitments()).toHaveLength(3);
  });

  it('a candidate already stored is not generated again, even if it was postponed or cancelled', async () => {
    const houseCat = (await t.db.select().from(category).where(eq(category.name, 'Casa')))[0]!.id;
    const cardCat = await cardPaymentCategoryId(t.db);
    await t.db.insert(commitment).values([
      // October electricity was touched early and postponed to November (D5: period moves, origin stays)
      { sourceKey: `re:${ids.power}:2026-10-01`, recurringExpenseId: ids.power, description: 'Luz', categoryId: houseCat, originPeriod: OCT, period: '2026-11-01', currency: 'ARS', estimatedAmount: '45000.00' },
      // October card payment was cancelled
      { sourceKey: `cc:${ids.card}:2026-10-01:ARS`, creditCardId: ids.card, description: 'Visa', categoryId: cardCat, originPeriod: OCT, period: OCT, currency: 'ARS', estimatedAmount: '1.00', status: 'cancelled', cancellationReason: 'test' },
    ]);
    const result = await openMonth(t.db, OCT, userId);
    expect(result).toMatchObject({ status: 'opened', commitments: 1 }); // only the loan installment is new
    const rows = await storedCommitments();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.sourceKey?.startsWith('re:'))).toMatchObject({ period: '2026-11-01' });
    expect(rows.find((r) => r.sourceKey?.startsWith('cc:'))).toMatchObject({ status: 'cancelled', amount: '1.00' });
  });

  it('reports rules it could not generate', async () => {
    await t.db.delete(incomeSourceAmount);
    const result = await openMonth(t.db, OCT, userId);
    expect(result).toMatchObject({
      status: 'opened',
      incomes: 0,
      issues: [{ kind: 'missing_amount', origin: 'income_source', id: ids.salary, period: OCT }],
    });
  });

  it('fails without changes if the card payment category was not seeded', async () => {
    await t.db.delete(category).where(eq(category.name, 'Tarjetas de crédito'));
    await expect(openMonth(t.db, OCT, userId)).rejects.toThrow(/run the seed/);
    expect(await t.db.select().from(month)).toHaveLength(0); // the transaction rolled back
  });
});
