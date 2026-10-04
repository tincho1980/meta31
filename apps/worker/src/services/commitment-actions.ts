import type { ActualAmountInput, CancelInput, CancelledLine, CommitmentDetail, IncomeDetail, PostponeInput } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { addMonths, comparePeriods, moneyToDb, paymentStatus, periodOf, toMoney, toPeriod } from '@meta31/domain';
import { and, eq } from 'drizzle-orm';
import { ServiceError } from './errors.js';
import { amountInForce, getCommitmentDetail } from './payments.js';

const { commitment, commitmentPayment, income, recurringExpenseAmount } = schema;

async function load(db: Db, id: string) {
  const [c] = await db.select().from(commitment).where(eq(commitment.id, id));
  if (!c) throw new ServiceError('not_found');
  return c;
}

async function allocatedOf(db: Db, id: string) {
  const rows = await db.select({ allocated: commitmentPayment.allocatedAmount }).from(commitmentPayment).where(eq(commitmentPayment.commitmentId, id));
  return rows.map((r) => toMoney(r.allocated));
}

/**
 * Postpones a commitment to a date (D5, RF-28): `period` moves to that date's month and
 * `origin_period` never changes, so "postponed" stays derivable. It can be postponed again.
 * With part of it paid, it splits in one transaction: the original stays paid by what was
 * paid and a child (`parent_commitment_id`, no `source_key`) carries the rest to the new month.
 */
export async function postponeCommitment(db: Db, id: string, input: PostponeInput, userId: string): Promise<CommitmentDetail> {
  const c = await load(db, id);
  if (c.status === 'cancelled') throw new ServiceError('conflict', 'cancelled');
  if (c.status === 'paid') throw new ServiceError('conflict', 'already_paid');
  const target = periodOf(input.dueDate);
  if (comparePeriods(target, toPeriod(c.period)) < 0) throw new ServiceError('conflict', 'postpone_backwards');

  if (c.status === 'pending') {
    await db.update(commitment).set({ period: target, dueDate: input.dueDate, updatedBy: userId }).where(eq(commitment.id, id));
    return getCommitmentDetail(db, id);
  }

  // partially paid: split (D5)
  const paid = (await allocatedOf(db, id)).reduce((acc, a) => acc.plus(a), toMoney('0'));
  const rest = amountInForce(c).minus(paid);
  const childId = await db.transaction(async (tx) => {
    // the original is closed by what was paid: its amount in force becomes the paid amount
    await tx
      .update(commitment)
      .set({ actualAmount: moneyToDb(paid.minus(toMoney(c.surcharge))), status: 'paid', updatedBy: userId })
      .where(eq(commitment.id, id));
    const [child] = await tx
      .insert(commitment)
      .values({
        sourceKey: null,
        creditCardId: c.creditCardId,
        recurringExpenseId: c.recurringExpenseId,
        oneOffExpenseId: c.oneOffExpenseId,
        loanId: c.loanId,
        installmentNumber: c.installmentNumber,
        parentCommitmentId: c.id,
        description: c.description,
        categoryId: c.categoryId,
        originPeriod: c.originPeriod,
        period: target,
        dueDate: input.dueDate,
        currency: c.currency,
        estimatedAmount: moneyToDb(rest),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: commitment.id });
    return child!.id;
  });
  return getCommitmentDetail(db, childId);
}

/** Cancels a commitment with a reason (RF-28): it stops counting and is never regenerated (D1). */
export async function cancelCommitment(db: Db, id: string, input: CancelInput, userId: string): Promise<CommitmentDetail> {
  const c = await load(db, id);
  if (c.status === 'cancelled') throw new ServiceError('conflict', 'cancelled');
  if ((await allocatedOf(db, id)).length > 0) throw new ServiceError('conflict', 'has_payments');
  await db.update(commitment).set({ status: 'cancelled', cancellationReason: input.reason, updatedBy: userId }).where(eq(commitment.id, id));
  return getCommitmentDetail(db, id);
}

/** Restores a commitment cancelled by mistake: back to pending (it has no payments). */
export async function restoreCommitment(db: Db, id: string, userId: string): Promise<CommitmentDetail> {
  const c = await load(db, id);
  if (c.status !== 'cancelled') throw new ServiceError('conflict', 'not_cancelled');
  const status = paymentStatus(amountInForce(c), await allocatedOf(db, id));
  await db.update(commitment).set({ status, cancellationReason: null, updatedBy: userId }).where(eq(commitment.id, id));
  return getCommitmentDetail(db, id);
}

type IncomeRow = typeof income.$inferSelect;

const toIncomeDetail = (i: IncomeRow): IncomeDetail => ({
  id: i.id,
  description: i.description,
  currency: i.currency,
  estimatedAmount: i.estimatedAmount,
  actualAmount: i.actualAmount,
  receivedDate: i.receivedDate,
  appliedRate: i.appliedRate,
  status: i.status,
});

/** Cancels an expected income ("this month it does not come in"); the reason is not stored for incomes. */
export async function cancelIncome(db: Db, id: string, userId: string): Promise<IncomeDetail> {
  const [i] = await db.select().from(income).where(eq(income.id, id));
  if (!i) throw new ServiceError('not_found');
  if (i.status !== 'expected') throw new ServiceError('conflict', 'not_expected');
  const [row] = await db.update(income).set({ status: 'cancelled', updatedBy: userId }).where(eq(income.id, id)).returning();
  return toIncomeDetail(row!);
}

export async function restoreIncome(db: Db, id: string, userId: string): Promise<IncomeDetail> {
  const [i] = await db.select().from(income).where(eq(income.id, id));
  if (!i) throw new ServiceError('not_found');
  if (i.status !== 'cancelled') throw new ServiceError('conflict', 'not_cancelled');
  const [row] = await db.update(income).set({ status: 'expected', updatedBy: userId }).where(eq(income.id, id)).returning();
  return toIncomeDetail(row!);
}

/** What was cancelled in a month (commitments and incomes), to restore it if it was a mistake. */
export async function listCancelled(db: Db, period: string): Promise<CancelledLine[]> {
  const [cs, is] = await Promise.all([
    db.select().from(commitment).where(and(eq(commitment.period, period), eq(commitment.status, 'cancelled'))),
    db.select().from(income).where(and(eq(income.period, period), eq(income.status, 'cancelled'))),
  ]);
  return [
    ...is.map((i) => ({
      id: i.id,
      kind: 'income' as const,
      description: i.description,
      currency: i.currency,
      amount: i.actualAmount ?? i.estimatedAmount,
      reason: null,
    })),
    ...cs.map((c) => ({
      id: c.id,
      kind: 'commitment' as const,
      description: c.description,
      currency: c.currency,
      amount: moneyToDb(amountInForce(c)),
      reason: c.cancellationReason,
    })),
  ];
}

/**
 * Loads the real amount (rule 10): it replaces the estimate and the status is recomputed against
 * what is already paid. For a recurring expense, `updateFollowing` makes it the estimate from the
 * month after its origin month (RF-19), in the same transaction.
 */
export async function setActualAmount(db: Db, id: string, input: ActualAmountInput, userId: string): Promise<CommitmentDetail> {
  const c = await load(db, id);
  if (c.status === 'cancelled') throw new ServiceError('conflict', 'cancelled');
  if (input.updateFollowing && !c.recurringExpenseId) throw new ServiceError('conflict', 'not_recurring');
  const allocated = await allocatedOf(db, id);
  const status = paymentStatus(toMoney(input.actualAmount).plus(toMoney(c.surcharge)), allocated);
  await db.transaction(async (tx) => {
    await tx.update(commitment).set({ actualAmount: input.actualAmount, status, updatedBy: userId }).where(eq(commitment.id, id));
    if (input.updateFollowing) {
      const fromPeriod = addMonths(toPeriod(c.originPeriod), 1);
      await tx
        .insert(recurringExpenseAmount)
        .values({ recurringExpenseId: c.recurringExpenseId!, fromPeriod, amount: input.actualAmount, createdBy: userId, updatedBy: userId })
        .onConflictDoUpdate({
          target: [recurringExpenseAmount.recurringExpenseId, recurringExpenseAmount.fromPeriod],
          set: { amount: input.actualAmount, updatedBy: userId },
        });
    }
  });
  return getCommitmentDetail(db, id);
}

/** Removes a real amount loaded by mistake: back to the estimate (the amount history is left as is). */
export async function clearActualAmount(db: Db, id: string, userId: string): Promise<CommitmentDetail> {
  const c = await load(db, id);
  if (c.status === 'cancelled') throw new ServiceError('conflict', 'cancelled');
  const status = paymentStatus(toMoney(c.estimatedAmount).plus(toMoney(c.surcharge)), await allocatedOf(db, id));
  await db.update(commitment).set({ actualAmount: null, status, updatedBy: userId }).where(eq(commitment.id, id));
  return getCommitmentDetail(db, id);
}
