import { cardPaymentCategoryId, findUserByEmail, schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';

const { category, commitment, creditCard, income, incomeSource, incomeSourceAmount, installmentPurchase, loan, month } = schema;
const { recurringExpense, recurringExpenseAmount } = schema;

const OCT = toPeriod('2026-10-01');

let t: TestDb;
let userId: string;
const ids: Record<string, string> = {};

/** Rules for every generator: salary, electricity, yearly tax, loan and a card with an installment purchase. */
async function loadFixtures() {
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  userId = (await findUserByEmail(t.db, 'martin@example.com'))!.id;
  const [salaryCat, houseCat, loanCat] = await t.db
    .insert(category)
    .values([
      { name: 'Sueldos', kind: 'income' },
      { name: 'Casa', kind: 'expense' },
      { name: 'Préstamos', kind: 'expense' },
    ])
    .returning({ id: category.id });

  const [salary] = await t.db
    .insert(incomeSource)
    .values({ name: 'Sueldo', categoryId: salaryCat!.id, currency: 'ARS', expectedDay: 5, validFrom: '2026-01-01' })
    .returning({ id: incomeSource.id });
  await t.db.insert(incomeSourceAmount).values({ incomeSourceId: salary!.id, fromPeriod: '2026-01-01', amount: '1500000.00' });
  ids.salary = salary!.id;

  const [power, tax] = await t.db
    .insert(recurringExpense)
    .values([
      { name: 'Luz', class: 'utility', categoryId: houseCat!.id, currency: 'ARS', dueDay: 20, validFrom: '2026-01-01' },
      { name: 'ARBA', class: 'tax', categoryId: houseCat!.id, currency: 'ARS', everyMonths: 12, anchorMonth: 3, validFrom: '2026-01-01' },
    ])
    .returning({ id: recurringExpense.id });
  await t.db.insert(recurringExpenseAmount).values([
    { recurringExpenseId: power!.id, fromPeriod: '2026-01-01', amount: '45000.00' },
    { recurringExpenseId: tax!.id, fromPeriod: '2026-01-01', amount: '480000.00' },
  ]);
  ids.power = power!.id;

  const [l] = await t.db
    .insert(loan)
    .values({
      lender: 'Banco',
      holderId: userId,
      categoryId: loanCat!.id,
      currency: 'ARS',
      kind: 'fixed_rate',
      amortizationSystem: 'french',
      principal: '2400000.00',
      nominalAnnualRate: '65',
      grantedDate: '2026-03-10',
      installmentsTotal: 18,
      firstPeriod: '2026-04-01',
      dueDay: 31,
    })
    .returning({ id: loan.id });
  ids.loan = l!.id;

  const [card] = await t.db
    .insert(creditCard)
    .values({
      name: 'Visa',
      bank: 'Banco',
      country: 'AR',
      holderId: userId,
      localCurrency: 'ARS',
      closingDay: 25,
      dueDay: 8,
      estimatedSpendLocal: '300000.00',
      estimatedSpendUsd: '0',
    })
    .returning({ id: creditCard.id });
  await t.db.insert(installmentPurchase).values({
    creditCardId: card!.id,
    description: 'Heladera',
    categoryId: houseCat!.id,
    purchaseDate: '2026-08-15',
    currency: 'ARS',
    installmentAmount: '100000.00',
    installmentsTotal: 6,
    firstPeriod: '2026-09-01',
  });
  ids.card = card!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  await loadFixtures();
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
