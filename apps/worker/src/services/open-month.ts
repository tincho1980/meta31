import { type Db, schema } from '@meta31/db';
import {
  type CommitmentCandidate,
  type GenerationIssue,
  generateForPeriod,
  type IncomeCandidate,
  moneyToDb,
  type Period,
} from '@meta31/domain';
import { loadRules } from './rules.js';

const { commitment, income, month } = schema;

export type OpenMonthResult =
  | { status: 'already_open' }
  | { status: 'opened'; commitments: number; incomes: number; issues: GenerationIssue[] };

/** Commitment row for a candidate: the origin goes to its own foreign key (exactly one, by check). */
function commitmentValues(c: CommitmentCandidate, userId: string): typeof commitment.$inferInsert {
  return {
    sourceKey: c.sourceKey,
    creditCardId: c.origin.kind === 'credit_card' ? c.origin.id : null,
    recurringExpenseId: c.origin.kind === 'recurring_expense' ? c.origin.id : null,
    oneOffExpenseId: c.origin.kind === 'one_off_expense' ? c.origin.id : null,
    loanId: c.origin.kind === 'loan' ? c.origin.id : null,
    installmentNumber: c.installmentNumber,
    description: c.description,
    categoryId: c.categoryId,
    originPeriod: c.period,
    period: c.period,
    dueDate: c.dueDate,
    currency: c.currency,
    estimatedAmount: moneyToDb(c.estimatedAmount),
    createdBy: userId,
    updatedBy: userId,
  };
}

function incomeValues(i: IncomeCandidate, userId: string): typeof income.$inferInsert {
  return {
    sourceKey: i.sourceKey,
    incomeSourceId: i.incomeSourceId,
    description: i.description,
    categoryId: i.categoryId,
    period: i.period,
    expectedDate: i.expectedDate,
    currency: i.currency,
    estimatedAmount: moneyToDb(i.estimatedAmount),
    createdBy: userId,
    updatedBy: userId,
  };
}

/**
 * Opens a month (RF-27, D1): materializes every commitment and income the rules generate for it.
 * Idempotent on two levels, in a single transaction:
 * - the `month` row (PK = period): if it already exists, nothing else happens;
 * - `source_key` unique: a candidate already stored (touched earlier, postponed or cancelled)
 *   is skipped by ON CONFLICT DO NOTHING, so two users opening at once never duplicate rows.
 */
export async function openMonth(db: Db, period: Period, userId: string): Promise<OpenMonthResult> {
  return db.transaction(async (tx) => {
    const opened = await tx
      .insert(month)
      .values({ period, openedBy: userId, createdBy: userId, updatedBy: userId })
      .onConflictDoNothing({ target: month.period })
      .returning({ period: month.period });
    if (opened.length === 0) return { status: 'already_open' };

    const generated = generateForPeriod(await loadRules(tx as unknown as Db), period);

    const insertedCommitments = generated.commitments.length
      ? await tx
          .insert(commitment)
          .values(generated.commitments.map((c) => commitmentValues(c, userId)))
          .onConflictDoNothing({ target: commitment.sourceKey })
          .returning({ id: commitment.id })
      : [];
    const insertedIncomes = generated.incomes.length
      ? await tx
          .insert(income)
          .values(generated.incomes.map((i) => incomeValues(i, userId)))
          .onConflictDoNothing({ target: income.sourceKey })
          .returning({ id: income.id })
      : [];

    return {
      status: 'opened',
      commitments: insertedCommitments.length,
      incomes: insertedIncomes.length,
      issues: generated.issues,
    };
  });
}
