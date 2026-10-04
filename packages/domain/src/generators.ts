import { type AmountFrom, amountInEffect } from './amounts.js';
import type { Currency } from './exchange.js';
import { amortizationSchedule, type LoanTerms, uvaToPesos } from './loan.js';
import { Money } from './money.js';
import { addMonths, dateInPeriod, type Period, toPeriod } from './period.js';
import { generatesIn, installmentNumberIn, isActiveIn, type Periodicity, type Validity } from './periodicity.js';
import { sourceKey } from './source-key.js';

// ---------------------------------------------------------------------------
// Rules: the data each generator needs, as the use cases read it from the database
// (camelCase, amounts already converted to Money at the boundary).
// ---------------------------------------------------------------------------

export type IncomeSourceRule = Periodicity &
  Validity & {
    id: string;
    name: string;
    categoryId: string;
    currency: Currency;
    expectedDay: number | null;
    amounts: readonly AmountFrom[];
  };

export type RecurringExpenseRule = Periodicity &
  Validity & {
    id: string;
    name: string;
    categoryId: string;
    currency: Currency;
    dueDay: number | null;
    amounts: readonly AmountFrom[];
  };

export type OneOffExpenseRule = {
  id: string;
  description: string;
  categoryId: string;
  currency: Currency;
  totalAmount: Money;
  installments: number;
  firstPeriod: string;
  plannedDate: string | null;
};

export type LoanRule = LoanTerms & {
  id: string;
  lender: string;
  categoryId: string;
  currency: Currency;
  kind: 'fixed_rate' | 'uva';
};

export type InstallmentPurchaseRule = {
  id: string;
  currency: Currency;
  installmentAmount: Money;
  installmentsTotal: number;
  firstPeriod: string;
};

export type SubscriptionRule = Validity & { id: string; currency: Currency; amount: Money };

/** Real statement already loaded for the period: it replaces the estimate (RF-16). */
export type CardStatementTotals = { period: string; dueDate: string; totalLocal: Money; totalUsd: Money };

export type CreditCardRule = {
  id: string;
  name: string;
  active: boolean;
  localCurrency: Currency;
  dueDay: number;
  estimatedSpendLocal: Money;
  estimatedSpendUsd: Money;
  installmentPurchases: readonly InstallmentPurchaseRule[];
  subscriptions: readonly SubscriptionRule[];
  statements: readonly CardStatementTotals[];
};

export type Rules = {
  incomeSources: readonly IncomeSourceRule[];
  recurringExpenses: readonly RecurringExpenseRule[];
  oneOffExpenses: readonly OneOffExpenseRule[];
  loans: readonly LoanRule[];
  creditCards: readonly CreditCardRule[];
  /** Category for card statement payments (credit cards have no category of their own). */
  cardPaymentCategoryId: string;
  /** Latest UVA value loaded by hand, to estimate UVA loan installments in pesos. */
  latestUvaValue: Money | null;
};

// ---------------------------------------------------------------------------
// Candidates: virtual rows with the shape of `commitment` and `income`.
// ---------------------------------------------------------------------------

export type CommitmentOrigin =
  | { kind: 'credit_card'; id: string }
  | { kind: 'recurring_expense'; id: string }
  | { kind: 'one_off_expense'; id: string }
  | { kind: 'loan'; id: string };

export type CommitmentCandidate = {
  sourceKey: string;
  origin: CommitmentOrigin;
  installmentNumber: number | null;
  description: string;
  categoryId: string;
  period: Period;
  dueDate: string | null;
  currency: Currency;
  estimatedAmount: Money;
};

export type IncomeCandidate = {
  sourceKey: string;
  incomeSourceId: string;
  description: string;
  categoryId: string;
  period: Period;
  expectedDate: string | null;
  currency: Currency;
  estimatedAmount: Money;
};

/** Something a rule could not generate; shown to the user instead of silently dropped. */
export type GenerationIssue = {
  kind: 'missing_amount' | 'missing_uva_value';
  origin: 'income_source' | 'recurring_expense' | 'loan';
  id: string;
  period: Period;
};

export type Generated = {
  commitments: CommitmentCandidate[];
  incomes: IncomeCandidate[];
  issues: GenerationIssue[];
};

const cents = (x: Money) => x.toDecimalPlaces(2, Money.ROUND_HALF_UP);
const ZERO = new Money(0);

// ---------------------------------------------------------------------------
// Generators, one per rule type, for a single period.
// ---------------------------------------------------------------------------

/** Expected income of a source in a month (RF-08): in force, due by periodicity, amount in force (rule 7). */
function incomeSourceCandidate(rule: IncomeSourceRule, period: Period, issues: GenerationIssue[]): IncomeCandidate | null {
  if (!generatesIn(rule, period)) return null;
  const amount = amountInEffect(rule.amounts, period);
  if (amount === null) {
    issues.push({ kind: 'missing_amount', origin: 'income_source', id: rule.id, period });
    return null;
  }
  return {
    sourceKey: sourceKey.incomeSource(rule.id, period),
    incomeSourceId: rule.id,
    description: rule.name,
    categoryId: rule.categoryId,
    period,
    expectedDate: rule.expectedDay === null ? null : dateInPeriod(period, rule.expectedDay),
    currency: rule.currency,
    estimatedAmount: cents(amount),
  };
}

/** Utilities, taxes, condo fees, recurring and budget items (D2): one commitment when due (rule 8). */
function recurringExpenseCandidate(
  rule: RecurringExpenseRule,
  period: Period,
  issues: GenerationIssue[],
): CommitmentCandidate | null {
  if (!generatesIn(rule, period)) return null;
  const amount = amountInEffect(rule.amounts, period);
  if (amount === null) {
    issues.push({ kind: 'missing_amount', origin: 'recurring_expense', id: rule.id, period });
    return null;
  }
  return {
    sourceKey: sourceKey.recurringExpense(rule.id, period),
    origin: { kind: 'recurring_expense', id: rule.id },
    installmentNumber: null,
    description: rule.name,
    categoryId: rule.categoryId,
    period,
    dueDate: rule.dueDay === null ? null : dateInPeriod(period, rule.dueDay),
    currency: rule.currency,
    estimatedAmount: cents(amount),
  };
}

/**
 * Installment `n` of a one-off expense paid outside the card (RF-21):
 * total / installments rounded to cents; the last one absorbs the difference.
 */
export function oneOffInstallmentAmount(total: Money, installments: number, n: number): Money {
  if (!Number.isInteger(installments) || installments < 1) throw new RangeError(`Invalid installments: ${installments}`);
  if (!Number.isInteger(n) || n < 1 || n > installments) throw new RangeError(`Invalid installment number: ${n}`);
  const regular = cents(total.dividedBy(installments));
  return n < installments ? regular : cents(total).minus(regular.times(installments - 1));
}

function oneOffExpenseCandidate(rule: OneOffExpenseRule, period: Period): CommitmentCandidate | null {
  const first = toPeriod(rule.firstPeriod);
  const n = installmentNumberIn(first, rule.installments, period);
  if (n === null) return null;
  const suffix = rule.installments > 1 ? ` (${n}/${rule.installments})` : '';
  return {
    sourceKey: sourceKey.oneOffExpense(rule.id, n),
    origin: { kind: 'one_off_expense', id: rule.id },
    installmentNumber: n,
    description: `${rule.description}${suffix}`,
    categoryId: rule.categoryId,
    period,
    dueDate: n === 1 ? rule.plannedDate : null,
    currency: rule.currency,
    estimatedAmount: oneOffInstallmentAmount(rule.totalAmount, rule.installments, n),
  };
}

/** Loan installment (RF-23): estimated = theoretical installment; UVA loans in pesos with the latest UVA. */
function loanCandidate(
  rule: LoanRule,
  latestUva: Money | null,
  period: Period,
  issues: GenerationIssue[],
): CommitmentCandidate | null {
  const n = installmentNumberIn(toPeriod(rule.firstPeriod), rule.installmentsTotal, period);
  if (n === null) return null;
  const row = amortizationSchedule(rule)[n - 1]!;
  let amount = row.total;
  if (rule.kind === 'uva') {
    if (latestUva === null) {
      issues.push({ kind: 'missing_uva_value', origin: 'loan', id: rule.id, period });
      return null;
    }
    amount = cents(uvaToPesos(row.total, latestUva));
  }
  return {
    sourceKey: sourceKey.loan(rule.id, n),
    origin: { kind: 'loan', id: rule.id },
    installmentNumber: n,
    description: `${rule.lender} (${n}/${rule.installmentsTotal})`,
    categoryId: rule.categoryId,
    period,
    dueDate: row.dueDate,
    currency: rule.currency,
    estimatedAmount: amount,
  };
}

/**
 * Card statement payments for a period (RF-13, RF-14, RF-16, D4): one commitment per currency,
 * local and USD. With a real statement loaded, its totals; otherwise installments falling in the
 * period + subscriptions in force + estimated spend (only while the card is active).
 * Card purchases live only inside the statement (rule 1): there is never a commitment per purchase.
 * A currency with nothing to pay generates no commitment.
 */
function creditCardCandidates(card: CreditCardRule, period: Period, categoryId: string): CommitmentCandidate[] {
  const currencies: Currency[] = [card.localCurrency, 'USD'];
  const totals = new Map<Currency, Money>(currencies.map((c) => [c, ZERO]));
  const add = (currency: Currency, amount: Money, what: string) => {
    const current = totals.get(currency);
    if (current === undefined) {
      throw new RangeError(`${what} in ${currency} on card ${card.id}, which only bills ${currencies.join(' and ')}`);
    }
    totals.set(currency, current.plus(amount));
  };

  const statement = card.statements.find((s) => s.period === period);
  let dueDate = dateInPeriod(period, card.dueDay);
  if (statement) {
    add(card.localCurrency, statement.totalLocal, 'Statement');
    add('USD', statement.totalUsd, 'Statement');
    dueDate = statement.dueDate;
  } else {
    for (const purchase of card.installmentPurchases) {
      if (installmentNumberIn(toPeriod(purchase.firstPeriod), purchase.installmentsTotal, period) !== null) {
        add(purchase.currency, purchase.installmentAmount, `Installment purchase ${purchase.id}`);
      }
    }
    for (const sub of card.subscriptions) {
      if (isActiveIn(sub, period)) add(sub.currency, sub.amount, `Subscription ${sub.id}`);
    }
    if (card.active) {
      add(card.localCurrency, card.estimatedSpendLocal, 'Estimated spend');
      add('USD', card.estimatedSpendUsd, 'Estimated spend');
    }
  }

  return currencies
    .filter((currency) => !totals.get(currency)!.isZero())
    .map((currency) => ({
      sourceKey: sourceKey.creditCard(card.id, period, currency),
      origin: { kind: 'credit_card' as const, id: card.id },
      installmentNumber: null,
      description: currency === card.localCurrency ? card.name : `${card.name} (USD)`,
      categoryId,
      period,
      dueDate,
      currency,
      estimatedAmount: cents(totals.get(currency)!),
    }));
}

/** Every virtual commitment and income of a period, from all the rules (section 7, step 2). */
export function generateForPeriod(rules: Rules, period: Period): Generated {
  const issues: GenerationIssue[] = [];
  const incomes = rules.incomeSources
    .map((r) => incomeSourceCandidate(r, period, issues))
    .filter((c): c is IncomeCandidate => c !== null);
  const commitments: CommitmentCandidate[] = [
    ...rules.recurringExpenses.map((r) => recurringExpenseCandidate(r, period, issues)),
    ...rules.oneOffExpenses.map((r) => oneOffExpenseCandidate(r, period)),
    ...rules.loans.map((r) => loanCandidate(r, rules.latestUvaValue, period, issues)),
  ].filter((c): c is CommitmentCandidate => c !== null);
  for (const card of rules.creditCards) commitments.push(...creditCardCandidates(card, period, rules.cardPaymentCategoryId));
  return { commitments, incomes, issues };
}

/** Generation for `count` consecutive months from `from` (projection horizon, RF-31). */
export function generateForRange(rules: Rules, from: Period, count: number): Map<Period, Generated> {
  const result = new Map<Period, Generated>();
  for (let k = 0; k < count; k++) {
    const period = addMonths(from, k);
    result.set(period, generateForPeriod(rules, period));
  }
  return result;
}
