import type { CardStatement, CardStatementCreate, CardStatementUpdate } from '@meta31/contracts';
import { cardPaymentCategoryId, type Db, schema } from '@meta31/db';
import { periodOf, sourceKey, toPeriod } from '@meta31/domain';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { isUniqueViolation, ServiceError } from './errors.js';

const { cardStatement, commitment, creditCard, month } = schema;

type Row = typeof cardStatement.$inferSelect;

const toStatement = (row: Row): CardStatement => ({
  id: row.id,
  creditCardId: row.creditCardId,
  period: row.period,
  closingDate: row.closingDate,
  dueDate: row.dueDate,
  previousBalanceLocal: row.previousBalanceLocal,
  previousBalanceUsd: row.previousBalanceUsd,
  totalLocal: row.totalLocal,
  totalUsd: row.totalUsd,
  minimumPaymentLocal: row.minimumPaymentLocal,
});

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Reason recorded on a carried balance once the next statement includes it (data, in Spanish). */
export const CARRIED_INTO_STATEMENT = 'Incluido en el resumen como saldo anterior';

/**
 * The real statement replaces the estimate (RF-16, rule 10). Months not opened yet need nothing:
 * the generator already uses the statement (but a carried balance stored there is cancelled). In an opened month the card's commitments are
 * stored (D1), so the pending ones take the statement totals and due date, and a currency that
 * had no commitment gets one. Commitments already paid (in full or in part) are left alone.
 */
async function applyToStoredMonth(tx: Tx, row: Row, card: { name: string; localCurrency: 'ARS' | 'UYU' }, userId: string) {
  // rule 4: a balance carried from the previous statement (the rest of a partial payment,
  // postponed here) is already inside this statement's total as previous balance
  await tx
    .update(commitment)
    .set({ status: 'cancelled', cancellationReason: CARRIED_INTO_STATEMENT, updatedBy: userId })
    .where(
      and(
        eq(commitment.creditCardId, row.creditCardId),
        eq(commitment.period, row.period),
        isNotNull(commitment.parentCommitmentId),
        eq(commitment.status, 'pending'),
      ),
    );
  const [opened] = await tx.select({ period: month.period }).from(month).where(eq(month.period, row.period));
  if (!opened) return;
  const categoryId = await cardPaymentCategoryId(tx as unknown as Db);
  const totals = [
    { currency: card.localCurrency, amount: row.totalLocal, description: card.name },
    { currency: 'USD' as const, amount: row.totalUsd, description: `${card.name} (USD)` },
  ];
  for (const { currency, amount, description } of totals) {
    const key = sourceKey.creditCard(row.creditCardId, toPeriod(row.period), currency);
    const [stored] = await tx.select().from(commitment).where(eq(commitment.sourceKey, key));
    if (stored) {
      if (stored.status === 'pending') {
        await tx
          .update(commitment)
          .set({ estimatedAmount: amount, dueDate: row.dueDate, updatedBy: userId })
          .where(eq(commitment.id, stored.id));
      }
    } else if (/[1-9]/.test(amount)) {
      await tx.insert(commitment).values({
        sourceKey: key,
        creditCardId: row.creditCardId,
        description,
        categoryId,
        originPeriod: row.period,
        period: row.period,
        dueDate: row.dueDate,
        currency,
        estimatedAmount: amount,
        createdBy: userId,
        updatedBy: userId,
      });
    }
  }
}

/** Latest first, optionally for one card. */
export async function listCardStatements(db: Db, creditCardId?: string): Promise<CardStatement[]> {
  const rows = await db
    .select()
    .from(cardStatement)
    .where(creditCardId ? eq(cardStatement.creditCardId, creditCardId) : undefined)
    .orderBy(desc(cardStatement.period));
  return rows.map(toStatement);
}

async function cardOf(db: Db | Tx, creditCardId: string) {
  const [card] = await db
    .select({ name: creditCard.name, localCurrency: creditCard.localCurrency })
    .from(creditCard)
    .where(eq(creditCard.id, creditCardId));
  return card;
}

/** Loads a real statement (RF-11): one per card and month (also stops duplicates, D3). */
export async function createCardStatement(db: Db, input: CardStatementCreate, userId: string): Promise<CardStatement> {
  const card = await cardOf(db, input.creditCardId);
  if (!card) throw new ServiceError('conflict', 'invalid_reference');
  const localCurrency = card.localCurrency as 'ARS' | 'UYU';
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(cardStatement)
        .values({ ...input, period: periodOf(input.dueDate), createdBy: userId, updatedBy: userId })
        .returning();
      await applyToStoredMonth(tx, row!, { name: card.name, localCurrency }, userId);
      return toStatement(row!);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_statement');
    throw err;
  }
}

/** Corrects a statement; the month it belongs to follows its due date. */
export async function updateCardStatement(db: Db, id: string, input: CardStatementUpdate, userId: string): Promise<CardStatement> {
  const [current] = await db.select().from(cardStatement).where(eq(cardStatement.id, id));
  if (!current) throw new ServiceError('not_found');
  const closingDate = input.closingDate ?? current.closingDate;
  const dueDate = input.dueDate ?? current.dueDate;
  if (closingDate >= dueDate) throw new ServiceError('conflict', 'closing_after_due');
  if (periodOf(dueDate) !== current.period) throw new ServiceError('conflict', 'statement_month');
  const card = (await cardOf(db, current.creditCardId))!;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(cardStatement)
      .set({ ...input, updatedBy: userId })
      .where(eq(cardStatement.id, id))
      .returning();
    await applyToStoredMonth(tx, row!, { name: card.name, localCurrency: card.localCurrency as 'ARS' | 'UYU' }, userId);
    return toStatement(row!);
  });
}
