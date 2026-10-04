import type { FutureCommitment, LoanReport, SpendingByCategory } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { comparePeriods, currentPeriod, installmentDeviation, moneyToDb, monthsBetween, type Period, toMoney, toPeriod } from '@meta31/domain';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { listInstallmentPurchases, listSubscriptions } from './card-items.js';
import { listLoans } from './loans.js';
import { listOneOffExpenses } from './one-off-expenses.js';
import { projection } from './projection.js';

const { commitment, creditCard } = schema;

/**
 * Loans report (RF-23, RF-25): installments paid and left, end month and debt come with each
 * loan; the deviations are its installments with a real amount (a split installment has none).
 */
export async function loansReport(db: Db): Promise<LoanReport[]> {
  const loans = await listLoans(db);
  const stored = await db
    .select()
    .from(commitment)
    .where(and(isNotNull(commitment.loanId), isNotNull(commitment.actualAmount), ne(commitment.status, 'cancelled')));
  // a split installment (D5) has no single real amount: skip originals that have a child
  const childRows = await db
    .select({ parent: commitment.parentCommitmentId })
    .from(commitment)
    .where(and(isNotNull(commitment.loanId), isNotNull(commitment.parentCommitmentId)));
  const children = new Set(childRows.map((c) => c.parent));
  return loans.map((loan) => {
    const deviations = stored
      .filter((c) => c.loanId === loan.id && c.parentCommitmentId === null && !children.has(c.id))
      .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0))
      .map((c) => {
        const d = installmentDeviation(toMoney(c.estimatedAmount), toMoney(c.actualAmount!));
        return {
          number: c.installmentNumber ?? 0,
          dueDate: c.dueDate ?? c.period,
          theoretical: c.estimatedAmount,
          actual: c.actualAmount!,
          amount: moneyToDb(d.amount),
          percent: d.percent.toDecimalPlaces(1, 4).toFixed(1),
        };
      });
    const total = deviations.reduce((acc, d) => acc.plus(toMoney(d.amount)), toMoney('0'));
    return { loan, deviations, deviationTotal: moneyToDb(total) };
  });
}

/**
 * Spending by category in a month (report): the month's commitments (real where known,
 * estimated otherwise) summed in ARS per category, biggest first. Card purchases count inside
 * the card payment (rule 1).
 */
export async function spendingByCategory(db: Db, period: Period): Promise<SpendingByCategory> {
  const [month] = await projection(db, period, 1);
  const byCategory = new Map<string, { amount: ReturnType<typeof toMoney>; lines: number; partial: boolean }>();
  for (const l of month!.commitments) {
    const g = byCategory.get(l.categoryId) ?? { amount: toMoney('0'), lines: 0, partial: false };
    if (l.amountArs) g.amount = g.amount.plus(l.amountArs);
    else g.partial = true;
    g.lines++;
    byCategory.set(l.categoryId, g);
  }
  const rows = [...byCategory]
    .map(([categoryId, g]) => ({ categoryId, amountArs: moneyToDb(g.amount), lines: g.lines, partial: g.partial }))
    .sort((a, b) => toMoney(b.amountArs).comparedTo(toMoney(a.amountArs)));
  const total = rows.reduce((acc, r) => acc.plus(toMoney(r.amountArs)), toMoney('0'));
  return { period, total: moneyToDb(total), rows };
}

/**
 * Future commitments by type (report): what is still running from this month on, what it takes
 * each month and when it ends — card installments, loans, card subscriptions and one-off
 * installments.
 */
export async function futureCommitments(db: Db): Promise<FutureCommitment[]> {
  const now = currentPeriod();
  const [purchases, subscriptions, loans, oneOffs, cards] = await Promise.all([
    listInstallmentPurchases(db),
    listSubscriptions(db),
    listLoans(db),
    listOneOffExpenses(db),
    db.select({ id: creditCard.id, name: creditCard.name }).from(creditCard),
  ]);
  const cardName = new Map(cards.map((c) => [c.id, c.name]));
  const left = (lastPeriod: string, firstPeriod: string) =>
    monthsBetween(comparePeriods(toPeriod(firstPeriod), now) > 0 ? toPeriod(firstPeriod) : now, toPeriod(lastPeriod)) + 1;
  const running = (lastPeriod: string) => comparePeriods(toPeriod(lastPeriod), now) >= 0;

  return [
    ...purchases
      .filter((p) => running(p.lastPeriod))
      .map((p) => ({
        kind: 'installment_purchase' as const,
        id: p.id,
        description: p.description,
        detail: cardName.get(p.creditCardId) ?? null,
        currency: p.currency,
        monthlyAmount: p.installmentAmount,
        lastPeriod: p.lastPeriod,
        remaining: left(p.lastPeriod, p.firstPeriod),
      })),
    ...loans
      .filter((l) => running(l.lastPeriod) && l.remainingInstallments > 0)
      .map((l) => ({
        kind: 'loan' as const,
        id: l.id,
        description: l.lender,
        detail: null,
        currency: l.kind === 'uva' ? ('ARS' as const) : l.currency,
        monthlyAmount: l.currentInstallment?.total ?? l.firstInstallment,
        lastPeriod: l.lastPeriod,
        remaining: l.remainingInstallments,
      })),
    ...subscriptions
      .filter((s) => s.validTo === null || s.validTo.slice(0, 7) >= now.slice(0, 7))
      .map((s) => ({
        kind: 'subscription' as const,
        id: s.id,
        description: s.description,
        detail: cardName.get(s.creditCardId) ?? null,
        currency: s.currency,
        monthlyAmount: s.amount,
        lastPeriod: s.validTo ? `${s.validTo.slice(0, 7)}-01` : null,
        remaining: null,
      })),
    ...oneOffs
      .filter((o) => running(o.lastPeriod))
      .map((o) => ({
        kind: 'one_off_expense' as const,
        id: o.id,
        description: o.description,
        detail: null,
        currency: o.currency,
        monthlyAmount: o.installmentAmount,
        lastPeriod: o.lastPeriod,
        remaining: left(o.lastPeriod, o.firstPeriod),
      })),
  ];
}
