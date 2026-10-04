import type { OneOffExpense, OneOffExpenseCreate, OneOffExpenseUpdate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { addMonths, moneyToDb, oneOffInstallmentAmount, toMoney, toPeriod } from '@meta31/domain';
import { desc, eq } from 'drizzle-orm';
import { checkNothingStored } from './deletion.js';
import { ServiceError } from './errors.js';
import { checkNotCardCategory, checkReferences } from './references.js';

const { oneOffExpense } = schema;

type Row = typeof oneOffExpense.$inferSelect;

/** With the installment amount and the last month, as the domain generates them. */
const toOneOffExpense = (row: Row): OneOffExpense => ({
  id: row.id,
  description: row.description,
  categoryId: row.categoryId,
  propertyId: row.propertyId,
  currency: row.currency,
  totalAmount: row.totalAmount,
  installments: row.installments,
  firstPeriod: row.firstPeriod,
  plannedDate: row.plannedDate,
  installmentAmount: moneyToDb(oneOffInstallmentAmount(toMoney(row.totalAmount), row.installments, 1)),
  lastPeriod: addMonths(toPeriod(row.firstPeriod), row.installments - 1),
});

/** Latest first month first. */
export async function listOneOffExpenses(db: Db): Promise<OneOffExpense[]> {
  const rows = await db.select().from(oneOffExpense).orderBy(desc(oneOffExpense.firstPeriod), desc(oneOffExpense.createdAt));
  return rows.map(toOneOffExpense);
}

async function checkCategory(db: Db, input: { categoryId?: string | undefined; propertyId?: string | null | undefined }) {
  await checkReferences(db, 'expense', { categoryId: input.categoryId, propertyId: input.propertyId });
  // paid by card it is an installment purchase of the statement, not a one-off expense (rule 1)
  await checkNotCardCategory(db, input.categoryId);
}

/** New one-off expense (RF-21); its installments are projected by the domain (D1). */
export async function createOneOffExpense(db: Db, input: OneOffExpenseCreate, userId: string): Promise<OneOffExpense> {
  await checkCategory(db, input);
  const [row] = await db
    .insert(oneOffExpense)
    .values({ ...input, createdBy: userId, updatedBy: userId })
    .returning();
  return toOneOffExpense(row!);
}

/**
 * Edits a one-off expense. Installments already stored (month opened, paid) keep their
 * amounts: stored rows win (D1); only the ones still virtual follow the change.
 */
export async function updateOneOffExpense(db: Db, id: string, input: OneOffExpenseUpdate, userId: string): Promise<OneOffExpense> {
  const [current] = await db.select().from(oneOffExpense).where(eq(oneOffExpense.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkCategory(db, input);
  const firstPeriod = input.firstPeriod ?? current.firstPeriod;
  const plannedDate = input.plannedDate === undefined ? current.plannedDate : input.plannedDate;
  if (plannedDate && plannedDate.slice(0, 7) !== firstPeriod.slice(0, 7)) {
    throw new ServiceError('conflict', 'planned_date_month');
  }
  const [row] = await db
    .update(oneOffExpense)
    .set({ ...input, updatedBy: userId })
    .where(eq(oneOffExpense.id, id))
    .returning();
  return toOneOffExpense(row!);
}

/** Deletes a one-off expense loaded by mistake, only if none of its installments is stored yet. */
export async function deleteOneOffExpense(db: Db, id: string): Promise<void> {
  const [current] = await db.select({ id: oneOffExpense.id }).from(oneOffExpense).where(eq(oneOffExpense.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkNothingStored(db, { oneOffExpenseId: id });
  await db.delete(oneOffExpense).where(eq(oneOffExpense.id, id));
}
