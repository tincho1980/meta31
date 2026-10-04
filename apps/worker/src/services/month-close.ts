import type { MonthStatus } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { moneyToDb, toMoney } from '@meta31/domain';
import { and, asc, eq, gt, inArray, ne } from 'drizzle-orm';
import { ServiceError } from './errors.js';

const { commitment, income, month, person } = schema;

/**
 * A closed month is final (its real result is definitive): nothing in it changes until it is
 * reopened. Every write on a commitment or income of a month calls this first.
 */
export async function assertMonthNotClosed(db: Db, period: string): Promise<void> {
  const [m] = await db.select({ status: month.status }).from(month).where(eq(month.period, period));
  if (m?.status === 'closed') throw new ServiceError('conflict', 'month_closed');
}

/** Lines still open in a month: commitments pending or partially paid, incomes expected. */
async function unsettled(db: Db, period: string): Promise<number> {
  const [cs, is] = await Promise.all([
    db.select({ id: commitment.id }).from(commitment).where(and(eq(commitment.period, period), inArray(commitment.status, ['pending', 'partially_paid']))),
    db.select({ id: income.id }).from(income).where(and(eq(income.period, period), eq(income.status, 'expected'))),
  ]);
  return cs.length + is.length;
}

/** State of a month: open or closed, what is still open, and what was moved to later months (D5). */
export async function getMonthStatus(db: Db, period: string): Promise<MonthStatus> {
  const [m] = await db
    .select({ status: month.status, closedAt: month.closedAt, closedBy: person.name })
    .from(month)
    .leftJoin(person, eq(person.id, month.closedBy))
    .where(eq(month.period, period));
  const moved = await db
    .select()
    .from(commitment)
    .where(and(eq(commitment.originPeriod, period), gt(commitment.period, period), ne(commitment.status, 'cancelled')))
    .orderBy(asc(commitment.period), asc(commitment.dueDate));
  return {
    status: m ? m.status : 'not_open',
    closedAt: m?.closedAt ? m.closedAt.toISOString() : null,
    closedBy: m?.closedBy ?? null,
    unsettled: m ? await unsettled(db, period) : 0,
    postponedOut: moved.map((c) => ({
      id: c.id,
      description: c.description,
      currency: c.currency,
      amount: moneyToDb(toMoney(c.actualAmount ?? c.estimatedAmount).plus(toMoney(c.surcharge))),
      period: c.period,
      dueDate: c.dueDate,
    })),
  };
}

/**
 * Closes a month: its real result becomes definitive. Only when nothing is left open — every
 * commitment paid, postponed or cancelled, every income received or cancelled.
 */
export async function closeMonth(db: Db, period: string, userId: string): Promise<MonthStatus> {
  const [m] = await db.select({ status: month.status }).from(month).where(eq(month.period, period));
  if (!m) throw new ServiceError('conflict', 'not_open');
  if (m.status === 'closed') throw new ServiceError('conflict', 'already_closed');
  if ((await unsettled(db, period)) > 0) throw new ServiceError('conflict', 'unsettled');
  await db
    .update(month)
    .set({ status: 'closed', closedAt: new Date(), closedBy: userId, updatedBy: userId })
    .where(eq(month.period, period));
  return getMonthStatus(db, period);
}

/** Reopens a closed month, to correct something. */
export async function reopenMonth(db: Db, period: string, userId: string): Promise<MonthStatus> {
  const [m] = await db.select({ status: month.status }).from(month).where(eq(month.period, period));
  if (!m || m.status !== 'closed') throw new ServiceError('conflict', 'not_closed');
  await db.update(month).set({ status: 'open', closedAt: null, closedBy: null, updatedBy: userId }).where(eq(month.period, period));
  return getMonthStatus(db, period);
}
