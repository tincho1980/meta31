import type { OneOffIncome, OneOffIncomeCreate, OneOffIncomeUpdate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ServiceError } from './errors.js';
import { assertMonthNotClosed } from './month-close.js';
import { checkReferences } from './references.js';

const { income } = schema;

type Row = typeof income.$inferSelect;

const toOneOffIncome = (row: Row): OneOffIncome => ({
  id: row.id,
  description: row.description,
  categoryId: row.categoryId,
  period: row.period,
  expectedDate: row.expectedDate,
  currency: row.currency,
  estimatedAmount: row.estimatedAmount,
  actualAmount: row.actualAmount,
  status: row.status,
});

/** One-off incomes are the incomes without a source (and so without `source_key`). */
const isOneOff = isNull(income.incomeSourceId);

async function getRow(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(income).where(and(eq(income.id, id), isOneOff));
  if (!row) throw new ServiceError('not_found');
  return row;
}

/** Latest month first. */
export async function listOneOffIncomes(db: Db): Promise<OneOffIncome[]> {
  const rows = await db.select().from(income).where(isOneOff).orderBy(desc(income.period), desc(income.expectedDate));
  return rows.map(toOneOffIncome);
}

/** New one-off income (RF-09): stored right away, it counts in its month as expected. */
export async function createOneOffIncome(db: Db, input: OneOffIncomeCreate, userId: string): Promise<OneOffIncome> {
  await checkReferences(db, 'income', { categoryId: input.categoryId });
  await assertMonthNotClosed(db, input.period);
  const [row] = await db
    .insert(income)
    .values({ ...input, incomeSourceId: null, sourceKey: null, createdBy: userId, updatedBy: userId })
    .returning();
  return toOneOffIncome(row!);
}

/** Edits it while it is still expected; once received it belongs to the month's operation (E2). */
export async function updateOneOffIncome(db: Db, id: string, input: OneOffIncomeUpdate, userId: string): Promise<OneOffIncome> {
  const current = await getRow(db, id);
  await assertMonthNotClosed(db, current.period);
  if (input.period) await assertMonthNotClosed(db, input.period);
  if (current.status !== 'expected') throw new ServiceError('conflict', 'not_expected');
  await checkReferences(db, 'income', { categoryId: input.categoryId });
  const period = input.period ?? current.period;
  const expectedDate = input.expectedDate === undefined ? current.expectedDate : input.expectedDate;
  if (expectedDate && expectedDate.slice(0, 7) !== period.slice(0, 7)) throw new ServiceError('conflict', 'expected_date_month');
  const [row] = await db
    .update(income)
    .set({ ...input, updatedBy: userId })
    .where(eq(income.id, id))
    .returning();
  return toOneOffIncome(row!);
}

/** A one-off income loaded by mistake can be deleted while it is still expected. */
export async function deleteOneOffIncome(db: Db, id: string): Promise<void> {
  const current = await getRow(db, id);
  await assertMonthNotClosed(db, current.period);
  if (current.status !== 'expected') throw new ServiceError('conflict', 'not_expected');
  await db.delete(income).where(eq(income.id, id));
}
