import type { CommitmentDetail, IncomeDetail, IncomeReceive, PaymentCreate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import {
  allocatePayment,
  type ExchangeRate,
  MissingRateError,
  moneyToDb,
  paymentPair,
  paymentStatus,
  rateInEffect,
  toMoney,
} from '@meta31/domain';
import { and, asc, eq } from 'drizzle-orm';
import { ServiceError } from './errors.js';

const { commitment, commitmentPayment, exchangeRate, income } = schema;

type CommitmentRow = typeof commitment.$inferSelect;

/** Monto vigente = coalesce(actual, estimated) + surcharge (modelo-de-datos 4.6). */
export const amountInForce = (c: CommitmentRow) => toMoney(c.actualAmount ?? c.estimatedAmount).plus(toMoney(c.surcharge));

async function loadRates(db: Db): Promise<ExchangeRate[]> {
  const rows = await db.select().from(exchangeRate);
  return rows.map((r) => ({ pair: r.pair, validFrom: r.validFrom, rate: toMoney(r.rate) }));
}

export async function getCommitmentDetail(db: Db, id: string): Promise<CommitmentDetail> {
  const [c] = await db.select().from(commitment).where(eq(commitment.id, id));
  if (!c) throw new ServiceError('not_found');
  const payments = await db
    .select()
    .from(commitmentPayment)
    .where(eq(commitmentPayment.commitmentId, id))
    .orderBy(asc(commitmentPayment.date), asc(commitmentPayment.createdAt));
  const paid = payments.reduce((acc, p) => acc.plus(toMoney(p.allocatedAmount)), toMoney('0'));
  return {
    id: c.id,
    description: c.description,
    period: c.period,
    currency: c.currency,
    amountInForce: moneyToDb(amountInForce(c)),
    paid: moneyToDb(paid),
    status: c.status,
    originPeriod: c.originPeriod,
    dueDate: c.dueDate,
    cancellationReason: c.cancellationReason,
    payments: payments.map((p) => ({
      id: p.id,
      commitmentId: p.commitmentId,
      date: p.date,
      paymentCurrency: p.paymentCurrency,
      amountPaid: p.amountPaid,
      appliedRate: p.appliedRate,
      allocatedAmount: p.allocatedAmount,
      paymentMethod: p.paymentMethod,
    })),
  };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Status from the payments against the amount in force, saved in the same transaction. */
async function refreshStatus(tx: Tx, c: CommitmentRow, userId: string): Promise<void> {
  const payments = await tx.select({ allocated: commitmentPayment.allocatedAmount }).from(commitmentPayment).where(eq(commitmentPayment.commitmentId, c.id));
  const status = paymentStatus(
    amountInForce(c),
    payments.map((p) => toMoney(p.allocated)),
  );
  await tx.update(commitment).set({ status, updatedBy: userId }).where(eq(commitment.id, c.id));
}

/**
 * Registers a payment (RF-28), in full or in part, in one transaction: the payment with the
 * rate actually applied (fixed forever, rule 6) and the commitment's new status. Paying in
 * another currency (pesos for a USD commitment, rule 3) uses the given rate, or the one in
 * force on the payment date.
 */
export async function addPayment(db: Db, id: string, input: PaymentCreate, userId: string): Promise<CommitmentDetail> {
  const [c] = await db.select().from(commitment).where(eq(commitment.id, id));
  if (!c) throw new ServiceError('not_found');
  if (c.status === 'cancelled') throw new ServiceError('conflict', 'cancelled');

  let pair: ReturnType<typeof paymentPair>;
  try {
    pair = paymentPair(input.paymentCurrency, c.currency);
  } catch {
    throw new ServiceError('conflict', 'payment_currency');
  }
  let appliedRate = input.appliedRate ? toMoney(input.appliedRate) : null;
  if (pair && !appliedRate) {
    try {
      appliedRate = rateInEffect(await loadRates(db), pair, input.date);
    } catch (err) {
      if (err instanceof MissingRateError) throw new ServiceError('conflict', 'missing_rate');
      throw err;
    }
  }
  const allocated = allocatePayment(toMoney(input.amountPaid), input.paymentCurrency, c.currency, pair ? appliedRate : null);

  await db.transaction(async (tx) => {
    await tx.insert(commitmentPayment).values({
      commitmentId: id,
      date: input.date,
      paymentCurrency: input.paymentCurrency,
      amountPaid: input.amountPaid,
      appliedRate: pair && appliedRate ? appliedRate.toFixed(6) : null,
      allocatedAmount: moneyToDb(allocated),
      paymentMethod: input.paymentMethod,
      createdBy: userId,
      updatedBy: userId,
    });
    await refreshStatus(tx, c, userId);
  });
  return getCommitmentDetail(db, id);
}

/** Undoes a payment loaded by mistake; the status is recomputed. */
export async function deletePayment(db: Db, id: string, paymentId: string, userId: string): Promise<CommitmentDetail> {
  const [c] = await db.select().from(commitment).where(eq(commitment.id, id));
  if (!c) throw new ServiceError('not_found');
  if (c.status === 'cancelled') throw new ServiceError('conflict', 'cancelled');
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(commitmentPayment)
      .where(and(eq(commitmentPayment.id, paymentId), eq(commitmentPayment.commitmentId, id)))
      .returning({ id: commitmentPayment.id });
    if (deleted.length === 0) throw new ServiceError('not_found');
    await refreshStatus(tx, c, userId);
  });
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

/**
 * Marks an income as received with the real amount (RF-08). An income in USD or UYU keeps the
 * rate in force on the day it came in (its own pair), fixed from then on (rule 6).
 */
export async function receiveIncome(db: Db, id: string, input: IncomeReceive, userId: string): Promise<IncomeDetail> {
  const [i] = await db.select().from(income).where(eq(income.id, id));
  if (!i) throw new ServiceError('not_found');
  if (i.status === 'cancelled') throw new ServiceError('conflict', 'cancelled');
  let appliedRate: string | null = null;
  if (i.currency !== 'ARS') {
    try {
      appliedRate = rateInEffect(await loadRates(db), i.currency === 'USD' ? 'USD_ARS' : 'UYU_USD', input.receivedDate).toFixed(6);
    } catch (err) {
      if (err instanceof MissingRateError) throw new ServiceError('conflict', 'missing_rate');
      throw err;
    }
  }
  const [row] = await db
    .update(income)
    .set({ status: 'received', actualAmount: input.actualAmount, receivedDate: input.receivedDate, appliedRate, updatedBy: userId })
    .where(eq(income.id, id))
    .returning();
  return toIncomeDetail(row!);
}

/** Undoes "received" (loaded by mistake): back to expected, with the estimate. */
export async function undoReceiveIncome(db: Db, id: string, userId: string): Promise<IncomeDetail> {
  const [i] = await db.select().from(income).where(eq(income.id, id));
  if (!i) throw new ServiceError('not_found');
  if (i.status !== 'received') throw new ServiceError('conflict', 'not_received');
  const [row] = await db
    .update(income)
    .set({ status: 'expected', actualAmount: null, receivedDate: null, appliedRate: null, updatedBy: userId })
    .where(eq(income.id, id))
    .returning();
  return toIncomeDetail(row!);
}
