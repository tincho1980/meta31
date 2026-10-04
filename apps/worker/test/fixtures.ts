// Shared fixtures for worker tests: one rule of each kind, loaded into a fresh PGlite database.
import { findUserByEmail, schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { toPeriod } from '@meta31/domain';

const { category, creditCard, incomeSource, incomeSourceAmount, installmentPurchase, loan } = schema;
const { recurringExpense, recurringExpenseAmount } = schema;

export const OCT = toPeriod('2026-10-01');

export type Fixtures = { t: TestDb; userId: string; ids: Record<string, string> };

/** Salary, electricity, yearly tax, a loan and a card with an installment purchase. */
export async function createFixtures(): Promise<Fixtures> {
  const t = await createTestDb();
  const ids: Record<string, string> = {};

  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  const userId = (await findUserByEmail(t.db, 'martin@example.com'))!.id;
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
  return { t, userId, ids };
}
