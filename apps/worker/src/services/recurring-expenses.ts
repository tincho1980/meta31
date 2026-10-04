import type { AmountEntry, AmountEntryCreate, AmountEntryUpdate, RecurringExpense, RecurringExpenseCreate, RecurringExpenseUpdate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { and, asc, eq, inArray, lte, ne } from 'drizzle-orm';
import { checkNothingStored } from './deletion.js';
import { isUniqueViolation, ServiceError } from './errors.js';
import { checkNotCardCategory, checkReferences } from './references.js';

const { recurringExpense, recurringExpenseAmount } = schema;

type ExpenseRow = typeof recurringExpense.$inferSelect;
type AmountRow = typeof recurringExpenseAmount.$inferSelect;

const toAmount = (row: AmountRow): AmountEntry => ({ id: row.id, fromPeriod: row.fromPeriod, amount: row.amount });

const toRecurringExpense = (row: ExpenseRow, amounts: AmountRow[]): RecurringExpense => ({
  id: row.id,
  name: row.name,
  categoryId: row.categoryId,
  class: row.class,
  provider: row.provider,
  propertyId: row.propertyId,
  beneficiaryId: row.beneficiaryId,
  currency: row.currency,
  everyMonths: row.everyMonths,
  anchorMonth: row.anchorMonth,
  dueDay: row.dueDay,
  validFrom: row.validFrom,
  validTo: row.validTo,
  amounts: amounts.map(toAmount),
});

async function amountsOf(db: Db, sourceIds: string[]): Promise<AmountRow[]> {
  if (sourceIds.length === 0) return [];
  return db
    .select()
    .from(recurringExpenseAmount)
    .where(inArray(recurringExpenseAmount.recurringExpenseId, sourceIds))
    .orderBy(asc(recurringExpenseAmount.fromPeriod));
}

/** Expenses by name, each with its estimated amount history oldest first. */
export async function listRecurringExpenses(db: Db): Promise<RecurringExpense[]> {
  const rows = await db.select().from(recurringExpense).orderBy(asc(recurringExpense.name));
  const amounts = await amountsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toRecurringExpense(r, amounts.filter((a) => a.recurringExpenseId === r.id)));
}

async function getRecurringExpense(db: Db, id: string): Promise<RecurringExpense> {
  const [row] = await db.select().from(recurringExpense).where(eq(recurringExpense.id, id));
  if (!row) throw new ServiceError('not_found');
  return toRecurringExpense(row, await amountsOf(db, [id]));
}

/** Some amount must be in force from the first month of the expense, or that month has no amount. */
async function checkAmountAtStart(db: Db, expenseId: string, validFrom: string): Promise<void> {
  const [first] = await db
    .select({ id: recurringExpenseAmount.id })
    .from(recurringExpenseAmount)
    .where(and(eq(recurringExpenseAmount.recurringExpenseId, expenseId), lte(recurringExpenseAmount.fromPeriod, validFrom)))
    .limit(1);
  if (!first) throw new ServiceError('conflict', 'no_amount_at_start');
}

/** New expense and its first estimated amount, in force from `validFrom`, in one transaction (RF-17, RF-18). */
export async function createRecurringExpense(db: Db, input: RecurringExpenseCreate, userId: string): Promise<RecurringExpense> {
  await checkReferences(db, 'expense', { categoryId: input.categoryId, personIds: [input.beneficiaryId], propertyId: input.propertyId });
  await checkNotCardCategory(db, input.categoryId);
  const { amount, ...fields } = input;
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(recurringExpense)
      .values({ ...fields, createdBy: userId, updatedBy: userId })
      .returning({ id: recurringExpense.id });
    await tx.insert(recurringExpenseAmount).values({
      recurringExpenseId: row!.id,
      fromPeriod: input.validFrom,
      amount,
      createdBy: userId,
      updatedBy: userId,
    });
    return row!.id;
  });
  return getRecurringExpense(db, id);
}

/**
 * Edits the expense. Ending it is setting `validTo` (rule 11): it stops being projected after
 * that month. Months already stored keep their commitments (D1: stored rows win).
 */
export async function updateRecurringExpense(db: Db, id: string, input: RecurringExpenseUpdate, userId: string): Promise<RecurringExpense> {
  const [current] = await db.select().from(recurringExpense).where(eq(recurringExpense.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkReferences(db, 'expense', { categoryId: input.categoryId, personIds: [input.beneficiaryId], propertyId: input.propertyId });
  await checkNotCardCategory(db, input.categoryId);
  const validFrom = input.validFrom ?? current.validFrom;
  const validTo = input.validTo === undefined ? current.validTo : input.validTo;
  if (validTo && validTo < validFrom) throw new ServiceError('conflict', 'valid_to_before_valid_from');
  if (input.validFrom) await checkAmountAtStart(db, id, validFrom);
  await db
    .update(recurringExpense)
    .set({ ...input, updatedBy: userId })
    .where(eq(recurringExpense.id, id));
  return getRecurringExpense(db, id);
}

/** A new estimated amount from a month on (RF-19): a tariff or tax update. */
export async function addRecurringExpenseAmount(
  db: Db,
  expenseId: string,
  input: AmountEntryCreate,
  userId: string,
): Promise<RecurringExpense> {
  const expense = await getRecurringExpense(db, expenseId);
  try {
    await db
      .insert(recurringExpenseAmount)
      .values({ recurringExpenseId: expenseId, ...input, createdBy: userId, updatedBy: userId });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_period');
    throw err;
  }
  return getRecurringExpense(db, expense.id);
}

/** Corrects an amount of the history or the month it starts. */
export async function updateRecurringExpenseAmount(
  db: Db,
  expenseId: string,
  amountId: string,
  input: AmountEntryUpdate,
  userId: string,
): Promise<RecurringExpense> {
  const [expense] = await db.select().from(recurringExpense).where(eq(recurringExpense.id, expenseId));
  if (!expense) throw new ServiceError('not_found');
  const [row] = await db
    .select()
    .from(recurringExpenseAmount)
    .where(and(eq(recurringExpenseAmount.id, amountId), eq(recurringExpenseAmount.recurringExpenseId, expenseId)));
  if (!row) throw new ServiceError('not_found');
  if (input.fromPeriod && input.fromPeriod > expense.validFrom) {
    // moving this row later must leave another one in force at the start
    const [other] = await db
      .select({ id: recurringExpenseAmount.id })
      .from(recurringExpenseAmount)
      .where(
        and(
          eq(recurringExpenseAmount.recurringExpenseId, expenseId),
          ne(recurringExpenseAmount.id, amountId),
          lte(recurringExpenseAmount.fromPeriod, expense.validFrom),
        ),
      )
      .limit(1);
    if (!other) throw new ServiceError('conflict', 'no_amount_at_start');
  }
  try {
    await db
      .update(recurringExpenseAmount)
      .set({ ...input, updatedBy: userId })
      .where(eq(recurringExpenseAmount.id, amountId));
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_period');
    throw err;
  }
  return getRecurringExpense(db, expenseId);
}

/**
 * Deletes a recurring expense loaded by mistake, with its amount history, only if none of its
 * commitments is stored yet. Otherwise it is ended with `validTo`.
 */
export async function deleteRecurringExpense(db: Db, id: string): Promise<void> {
  const [current] = await db.select({ id: recurringExpense.id }).from(recurringExpense).where(eq(recurringExpense.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkNothingStored(db, { recurringExpenseId: id });
  await db.transaction(async (tx) => {
    await tx.delete(recurringExpenseAmount).where(eq(recurringExpenseAmount.recurringExpenseId, id));
    await tx.delete(recurringExpense).where(eq(recurringExpense.id, id));
  });
}
