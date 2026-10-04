import { cardPaymentCategoryId, type Db, schema } from '@meta31/db';
import {
  type AmountFrom,
  type CreditCardRule,
  type IncomeSourceRule,
  type LoanRule,
  type OneOffExpenseRule,
  type RecurringExpenseRule,
  type Rules,
  toMoney,
} from '@meta31/domain';
import { desc, eq } from 'drizzle-orm';

const { cardStatement, creditCard, economicIndex, incomeSource, incomeSourceAmount, installmentPurchase, loan } = schema;
const { oneOffExpense, recurringExpense, recurringExpenseAmount, subscription } = schema;

/** Groups rows by a key (one query per table instead of one per rule). */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

const amountRows = (rows: readonly { fromPeriod: string; amount: string }[] | undefined): AmountFrom[] =>
  (rows ?? []).map((r) => ({ fromPeriod: r.fromPeriod, amount: toMoney(r.amount) }));

/**
 * Reads every rule that generates commitments or incomes (section 7, step 2) and converts
 * it to domain types: numeric strings become Money here, at the boundary. About ten queries
 * regardless of how many months are generated afterwards.
 */
export async function loadRules(db: Db): Promise<Rules> {
  const [
    sources,
    sourceAmounts,
    expenses,
    expenseAmounts,
    oneOffs,
    loans,
    cards,
    purchases,
    subscriptions,
    statements,
    latestUva,
    cardCategoryId,
  ] = await Promise.all([
    db.select().from(incomeSource),
    db.select().from(incomeSourceAmount),
    db.select().from(recurringExpense),
    db.select().from(recurringExpenseAmount),
    db.select().from(oneOffExpense),
    db.select().from(loan),
    db.select().from(creditCard),
    db.select().from(installmentPurchase),
    db.select().from(subscription),
    db.select().from(cardStatement),
    db.select({ value: economicIndex.value }).from(economicIndex).where(eq(economicIndex.kind, 'uva')).orderBy(desc(economicIndex.date)).limit(1),
    cardPaymentCategoryId(db),
  ]);

  const amountsBySource = groupBy(sourceAmounts, (r) => r.incomeSourceId);
  const amountsByExpense = groupBy(expenseAmounts, (r) => r.recurringExpenseId);
  const purchasesByCard = groupBy(purchases, (r) => r.creditCardId);
  const subscriptionsByCard = groupBy(subscriptions, (r) => r.creditCardId);
  const statementsByCard = groupBy(statements, (r) => r.creditCardId);

  const incomeSources: IncomeSourceRule[] = sources.map((s) => ({
    id: s.id,
    name: s.name,
    categoryId: s.categoryId,
    currency: s.currency,
    everyMonths: s.everyMonths,
    anchorMonth: s.anchorMonth,
    expectedDay: s.expectedDay,
    validFrom: s.validFrom,
    validTo: s.validTo,
    amounts: amountRows(amountsBySource.get(s.id)),
  }));

  const recurringExpenses: RecurringExpenseRule[] = expenses.map((e) => ({
    id: e.id,
    name: e.name,
    categoryId: e.categoryId,
    currency: e.currency,
    everyMonths: e.everyMonths,
    anchorMonth: e.anchorMonth,
    dueDay: e.dueDay,
    validFrom: e.validFrom,
    validTo: e.validTo,
    amounts: amountRows(amountsByExpense.get(e.id)),
  }));

  const oneOffExpenses: OneOffExpenseRule[] = oneOffs.map((o) => ({
    id: o.id,
    description: o.description,
    categoryId: o.categoryId,
    currency: o.currency,
    totalAmount: toMoney(o.totalAmount),
    installments: o.installments,
    firstPeriod: o.firstPeriod,
    plannedDate: o.plannedDate,
  }));

  const loanRules: LoanRule[] = loans.map(loanRuleOf);


  const creditCards: CreditCardRule[] = cards.map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    localCurrency: c.localCurrency,
    dueDay: c.dueDay,
    estimatedSpendLocal: toMoney(c.estimatedSpendLocal),
    estimatedSpendUsd: toMoney(c.estimatedSpendUsd),
    installmentPurchases: (purchasesByCard.get(c.id) ?? []).map((p) => ({
      id: p.id,
      currency: p.currency,
      installmentAmount: toMoney(p.installmentAmount),
      installmentsTotal: p.installmentsTotal,
      firstPeriod: p.firstPeriod,
    })),
    subscriptions: (subscriptionsByCard.get(c.id) ?? []).map((s) => ({
      id: s.id,
      currency: s.currency,
      amount: toMoney(s.amount),
      validFrom: s.validFrom,
      validTo: s.validTo,
    })),
    statements: (statementsByCard.get(c.id) ?? []).map((s) => ({
      period: s.period,
      dueDate: s.dueDate,
      totalLocal: toMoney(s.totalLocal),
      totalUsd: toMoney(s.totalUsd),
    })),
  }));

  return {
    incomeSources,
    recurringExpenses,
    oneOffExpenses,
    loans: loanRules,
    creditCards,
    cardPaymentCategoryId: cardCategoryId,
    latestUvaValue: latestUva[0] ? toMoney(latestUva[0].value) : null,
  };
}

/**
 * Loan row → domain rule. UVA loans are scheduled in UVAs (the check guarantees principal_uva
 * is present). Shared by the projection and the loan screen, so both use the same schedule.
 */
export function loanRuleOf(l: typeof schema.loan.$inferSelect): LoanRule {
  return {
    id: l.id,
    lender: l.lender,
    categoryId: l.categoryId,
    currency: l.currency,
    kind: l.kind,
    system: l.amortizationSystem,
    principal: toMoney(l.kind === 'uva' && l.principalUva !== null ? l.principalUva : l.principal),
    nominalAnnualRate: toMoney(l.nominalAnnualRate),
    interestVatRate: toMoney(l.interestVatRate),
    monthlyInsurance: toMoney(l.monthlyInsurance),
    grantedDate: l.grantedDate,
    firstPeriod: l.firstPeriod,
    dueDay: l.dueDay,
    installmentsTotal: l.installmentsTotal,
  };
}
