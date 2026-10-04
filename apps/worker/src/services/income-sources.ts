import type { AmountEntry, AmountEntryCreate, AmountEntryUpdate, IncomeSource, IncomeSourceCreate, IncomeSourceUpdate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { and, asc, eq, inArray, lte, ne } from 'drizzle-orm';
import { isUniqueViolation, ServiceError } from './errors.js';
import { checkReferences } from './references.js';

const { incomeSource, incomeSourceAmount } = schema;

type SourceRow = typeof incomeSource.$inferSelect;
type AmountRow = typeof incomeSourceAmount.$inferSelect;

const toAmount = (row: AmountRow): AmountEntry => ({ id: row.id, fromPeriod: row.fromPeriod, amount: row.amount });

const toIncomeSource = (row: SourceRow, amounts: AmountRow[]): IncomeSource => ({
  id: row.id,
  name: row.name,
  categoryId: row.categoryId,
  holderId: row.holderId,
  propertyId: row.propertyId,
  currency: row.currency,
  everyMonths: row.everyMonths,
  anchorMonth: row.anchorMonth,
  expectedDay: row.expectedDay,
  validFrom: row.validFrom,
  validTo: row.validTo,
  amounts: amounts.map(toAmount),
});

async function amountsOf(db: Db, sourceIds: string[]): Promise<AmountRow[]> {
  if (sourceIds.length === 0) return [];
  return db
    .select()
    .from(incomeSourceAmount)
    .where(inArray(incomeSourceAmount.incomeSourceId, sourceIds))
    .orderBy(asc(incomeSourceAmount.fromPeriod));
}

/** Sources by name, each with its amount history oldest first. */
export async function listIncomeSources(db: Db): Promise<IncomeSource[]> {
  const rows = await db.select().from(incomeSource).orderBy(asc(incomeSource.name));
  const amounts = await amountsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toIncomeSource(r, amounts.filter((a) => a.incomeSourceId === r.id)));
}

async function getIncomeSource(db: Db, id: string): Promise<IncomeSource> {
  const [row] = await db.select().from(incomeSource).where(eq(incomeSource.id, id));
  if (!row) throw new ServiceError('not_found');
  return toIncomeSource(row, await amountsOf(db, [id]));
}

/** Some amount must be in force from the first month of the source, or that month has no amount. */
async function checkAmountAtStart(db: Db, sourceId: string, validFrom: string): Promise<void> {
  const [first] = await db
    .select({ id: incomeSourceAmount.id })
    .from(incomeSourceAmount)
    .where(and(eq(incomeSourceAmount.incomeSourceId, sourceId), lte(incomeSourceAmount.fromPeriod, validFrom)))
    .limit(1);
  if (!first) throw new ServiceError('conflict', 'no_amount_at_start');
}

/** New source and its first amount, in force from `validFrom`, in one transaction (RF-07). */
export async function createIncomeSource(db: Db, input: IncomeSourceCreate, userId: string): Promise<IncomeSource> {
  await checkReferences(db, 'income', { categoryId: input.categoryId, personIds: [input.holderId], propertyId: input.propertyId });
  const { amount, ...fields } = input;
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(incomeSource)
      .values({ ...fields, createdBy: userId, updatedBy: userId })
      .returning({ id: incomeSource.id });
    await tx.insert(incomeSourceAmount).values({
      incomeSourceId: row!.id,
      fromPeriod: input.validFrom,
      amount,
      createdBy: userId,
      updatedBy: userId,
    });
    return row!.id;
  });
  return getIncomeSource(db, id);
}

/**
 * Edits the source. Ending it is setting `validTo` (rule 11): it stops being projected after
 * that month. Months already stored keep their incomes (D1: stored rows win).
 */
export async function updateIncomeSource(db: Db, id: string, input: IncomeSourceUpdate, userId: string): Promise<IncomeSource> {
  const [current] = await db.select().from(incomeSource).where(eq(incomeSource.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkReferences(db, 'income', { categoryId: input.categoryId, personIds: [input.holderId], propertyId: input.propertyId });
  const validFrom = input.validFrom ?? current.validFrom;
  const validTo = input.validTo === undefined ? current.validTo : input.validTo;
  if (validTo && validTo < validFrom) throw new ServiceError('conflict', 'valid_to_before_valid_from');
  if (input.validFrom) await checkAmountAtStart(db, id, validFrom);
  await db
    .update(incomeSource)
    .set({ ...input, updatedBy: userId })
    .where(eq(incomeSource.id, id));
  return getIncomeSource(db, id);
}

/** A new amount from a month on (rule 7): a raise or a rent update. */
export async function addIncomeSourceAmount(
  db: Db,
  sourceId: string,
  input: AmountEntryCreate,
  userId: string,
): Promise<IncomeSource> {
  const source = await getIncomeSource(db, sourceId);
  try {
    await db
      .insert(incomeSourceAmount)
      .values({ incomeSourceId: sourceId, ...input, createdBy: userId, updatedBy: userId });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_period');
    throw err;
  }
  return getIncomeSource(db, source.id);
}

/** Corrects an amount of the history or the month it starts. */
export async function updateIncomeSourceAmount(
  db: Db,
  sourceId: string,
  amountId: string,
  input: AmountEntryUpdate,
  userId: string,
): Promise<IncomeSource> {
  const [source] = await db.select().from(incomeSource).where(eq(incomeSource.id, sourceId));
  if (!source) throw new ServiceError('not_found');
  const [row] = await db
    .select()
    .from(incomeSourceAmount)
    .where(and(eq(incomeSourceAmount.id, amountId), eq(incomeSourceAmount.incomeSourceId, sourceId)));
  if (!row) throw new ServiceError('not_found');
  if (input.fromPeriod && input.fromPeriod > source.validFrom) {
    // moving this row later must leave another one in force at the start
    const [other] = await db
      .select({ id: incomeSourceAmount.id })
      .from(incomeSourceAmount)
      .where(
        and(
          eq(incomeSourceAmount.incomeSourceId, sourceId),
          ne(incomeSourceAmount.id, amountId),
          lte(incomeSourceAmount.fromPeriod, source.validFrom),
        ),
      )
      .limit(1);
    if (!other) throw new ServiceError('conflict', 'no_amount_at_start');
  }
  try {
    await db
      .update(incomeSourceAmount)
      .set({ ...input, updatedBy: userId })
      .where(eq(incomeSourceAmount.id, amountId));
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_period');
    throw err;
  }
  return getIncomeSource(db, sourceId);
}
