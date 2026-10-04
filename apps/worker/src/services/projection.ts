import { type Db, schema } from '@meta31/db';
import {
  addMonths,
  type CommitmentOrigin,
  type ExchangeRate,
  type MonthProjection,
  type Period,
  projectMonths,
  type StoredCommitment,
  type StoredIncome,
  toMoney,
} from '@meta31/domain';
import { between, isNotNull } from 'drizzle-orm';
import { loadRules } from './rules.js';

const { commitment, exchangeRate, income } = schema;

type CommitmentRow = typeof commitment.$inferSelect;

/** The single origin foreign key that is set (the check guarantees exactly one). */
function originOf(row: CommitmentRow): CommitmentOrigin {
  if (row.creditCardId) return { kind: 'credit_card', id: row.creditCardId };
  if (row.recurringExpenseId) return { kind: 'recurring_expense', id: row.recurringExpenseId };
  if (row.oneOffExpenseId) return { kind: 'one_off_expense', id: row.oneOffExpenseId };
  if (row.loanId) return { kind: 'loan', id: row.loanId };
  throw new Error(`Commitment ${row.id} has no origin`);
}

/**
 * Projection of `months` months from `from` (RF-31, RF-33): stored rows of the horizon merged
 * with the virtual candidates of the rules. Read only: nothing is materialized here.
 */
export async function projection(db: Db, from: Period, months: number): Promise<MonthProjection[]> {
  if (!Number.isInteger(months) || months < 1 || months > 36) throw new RangeError(`Invalid months: ${months}`);
  const to = addMonths(from, months - 1);

  const [rules, commitmentRows, incomeRows, commitmentKeys, incomeKeys, rateRows] = await Promise.all([
    loadRules(db),
    db.select().from(commitment).where(between(commitment.period, from, to)),
    db.select().from(income).where(between(income.period, from, to)),
    db.select({ key: commitment.sourceKey }).from(commitment).where(isNotNull(commitment.sourceKey)),
    db.select({ key: income.sourceKey }).from(income).where(isNotNull(income.sourceKey)),
    db.select().from(exchangeRate),
  ]);

  const commitments: StoredCommitment[] = commitmentRows.map((r) => ({
    id: r.id,
    sourceKey: r.sourceKey,
    origin: originOf(r),
    description: r.description,
    categoryId: r.categoryId,
    originPeriod: r.originPeriod,
    period: r.period,
    dueDate: r.dueDate,
    currency: r.currency,
    estimatedAmount: toMoney(r.estimatedAmount),
    actualAmount: r.actualAmount === null ? null : toMoney(r.actualAmount),
    surcharge: toMoney(r.surcharge),
    status: r.status,
  }));
  const incomes: StoredIncome[] = incomeRows.map((r) => ({
    id: r.id,
    sourceKey: r.sourceKey,
    incomeSourceId: r.incomeSourceId,
    description: r.description,
    categoryId: r.categoryId,
    period: r.period,
    expectedDate: r.expectedDate,
    currency: r.currency,
    estimatedAmount: toMoney(r.estimatedAmount),
    actualAmount: r.actualAmount === null ? null : toMoney(r.actualAmount),
    status: r.status,
  }));
  const storedKeys = new Set(
    [...commitmentKeys, ...incomeKeys].map((r) => r.key).filter((k): k is string => k !== null),
  );
  const rates: ExchangeRate[] = rateRows.map((r) => ({ pair: r.pair, validFrom: r.validFrom, rate: toMoney(r.rate) }));

  return projectMonths({ rules, commitments, incomes, storedKeys, rates, from, months });
}
