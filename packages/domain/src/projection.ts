import { type Currency, convert, type ExchangeRate, MissingRateError } from './exchange.js';
import {
  type CommitmentOrigin,
  type GenerationIssue,
  generateForPeriod,
  type Rules,
} from './generators.js';
import { unstoredCandidates } from './merge.js';
import { Money } from './money.js';
import { addMonths, type Period, toPeriod } from './period.js';
import { installmentNumberIn } from './periodicity.js';

// ---------------------------------------------------------------------------
// Stored rows, as the use cases read them (numeric already converted to Money).
// ---------------------------------------------------------------------------

export type CommitmentStatus = 'pending' | 'partially_paid' | 'paid' | 'cancelled';
export type IncomeStatus = 'expected' | 'received' | 'cancelled';

export type StoredCommitment = {
  id: string;
  sourceKey: string | null;
  origin: CommitmentOrigin;
  description: string;
  categoryId: string;
  originPeriod: string;
  period: string;
  dueDate: string | null;
  currency: Currency;
  estimatedAmount: Money;
  actualAmount: Money | null;
  surcharge: Money;
  status: CommitmentStatus;
};

export type StoredIncome = {
  id: string;
  sourceKey: string | null;
  /** null = one-off income (RF-09). */
  incomeSourceId: string | null;
  description: string;
  categoryId: string;
  period: string;
  expectedDate: string | null;
  currency: Currency;
  estimatedAmount: Money;
  actualAmount: Money | null;
  status: IncomeStatus;
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type LineOrigin = CommitmentOrigin['kind'] | 'income_source' | 'one_off_income';

export type ProjectionLine = {
  /** Stored row id, or null for a virtual line. */
  id: string | null;
  sourceKey: string | null;
  origin: LineOrigin;
  originId: string | null;
  description: string;
  categoryId: string;
  /** Due or expected date; the conversion uses the rate in force on it (or on day 1 of the month). */
  date: string | null;
  currency: Currency;
  /** Amount in force: actual if known, else estimated; commitments add their surcharge. */
  amount: Money;
  stored: boolean;
  status: CommitmentStatus | IncomeStatus | null;
  /** Derived, never stored (D5): the commitment was born in an earlier month. */
  postponed: boolean;
};

export type Totals = { incomes: Money; commitments: Money; result: Money };

export type ProjectionIssue = GenerationIssue | { kind: 'missing_rate'; pair: string; date: string; period: Period };

export type MonthProjection = {
  period: Period;
  incomes: ProjectionLine[];
  commitments: ProjectionLine[];
  /** Sums in each original currency: always available, no conversion involved. */
  byCurrency: Record<Currency, Totals>;
  /** Totals converted to ARS and to USD (RF-03); null if a rate is missing. */
  ars: Totals | null;
  usd: Totals | null;
  /**
   * Installment load (RF-33): card installments + loan installments, in ARS, over the month's
   * income in ARS. Null if a rate is missing; percent null if there is no income.
   */
  installmentLoad: { amountArs: Money; percent: Money | null } | null;
  issues: ProjectionIssue[];
};

export type ProjectionInput = {
  rules: Rules;
  /** Stored rows whose `period` falls in the horizon. */
  commitments: readonly StoredCommitment[];
  incomes: readonly StoredIncome[];
  /** Every stored `source_key` (any month, any status): a stored key always wins (D1). */
  storedKeys: ReadonlySet<string>;
  rates: readonly ExchangeRate[];
  from: Period;
  months: number;
};

const ZERO = new Money(0);
const CURRENCIES: Currency[] = ['ARS', 'USD', 'UYU'];

function totals(incomes: readonly ProjectionLine[], commitments: readonly ProjectionLine[], value: (l: ProjectionLine) => Money): Totals {
  const inc = incomes.reduce((acc, l) => acc.plus(value(l)), ZERO);
  const com = commitments.reduce((acc, l) => acc.plus(value(l)), ZERO);
  return { incomes: inc, commitments: com, result: inc.minus(com) };
}

function storedCommitmentLine(c: StoredCommitment): ProjectionLine {
  return {
    id: c.id,
    sourceKey: c.sourceKey,
    origin: c.origin.kind,
    originId: c.origin.id,
    description: c.description,
    categoryId: c.categoryId,
    date: c.dueDate,
    currency: c.currency,
    amount: (c.actualAmount ?? c.estimatedAmount).plus(c.surcharge),
    stored: true,
    status: c.status,
    postponed: c.originPeriod !== c.period,
  };
}

function storedIncomeLine(i: StoredIncome): ProjectionLine {
  return {
    id: i.id,
    sourceKey: i.sourceKey,
    origin: i.incomeSourceId === null ? 'one_off_income' : 'income_source',
    originId: i.incomeSourceId,
    description: i.description,
    categoryId: i.categoryId,
    date: i.expectedDate,
    currency: i.currency,
    amount: i.actualAmount ?? i.estimatedAmount,
    stored: true,
    status: i.status,
    postponed: false,
  };
}

/** Card installments falling in the month, from the rules (part of the card payment, RF-33). */
function cardInstallments(rules: Rules, period: Period): { amount: Money; currency: Currency }[] {
  return rules.creditCards.flatMap((card) =>
    card.installmentPurchases
      .filter((p) => installmentNumberIn(toPeriod(p.firstPeriod), p.installmentsTotal, period) !== null)
      .map((p) => ({ amount: p.installmentAmount, currency: p.currency })),
  );
}

/**
 * Monthly projection (RF-31, section 7): for each month, stored rows (not cancelled) plus the
 * virtual candidates whose key is not stored, summed as incomes − commitments. No carry-over
 * between months (rule 9): each month starts at zero; only postponed commitments move.
 */
export function projectMonths(input: ProjectionInput): MonthProjection[] {
  const result: MonthProjection[] = [];
  for (let k = 0; k < input.months; k++) {
    const period = addMonths(input.from, k);
    const generated = generateForPeriod(input.rules, period);
    const issues: ProjectionIssue[] = [...generated.issues];

    const commitments: ProjectionLine[] = [
      ...input.commitments.filter((c) => c.period === period && c.status !== 'cancelled').map(storedCommitmentLine),
      ...unstoredCandidates(generated.commitments, input.storedKeys).map((c) => ({
        id: null,
        sourceKey: c.sourceKey,
        origin: c.origin.kind,
        originId: c.origin.id,
        description: c.description,
        categoryId: c.categoryId,
        date: c.dueDate,
        currency: c.currency,
        amount: c.estimatedAmount,
        stored: false,
        status: null,
        postponed: false,
      })),
    ];
    const incomes: ProjectionLine[] = [
      ...input.incomes.filter((i) => i.period === period && i.status !== 'cancelled').map(storedIncomeLine),
      ...unstoredCandidates(generated.incomes, input.storedKeys).map((i) => ({
        id: null,
        sourceKey: i.sourceKey,
        origin: 'income_source' as const,
        originId: i.incomeSourceId,
        description: i.description,
        categoryId: i.categoryId,
        date: i.expectedDate,
        currency: i.currency,
        amount: i.estimatedAmount,
        stored: false,
        status: null,
        postponed: false,
      })),
    ];

    const byCurrency = Object.fromEntries(
      CURRENCIES.map((cur) => [
        cur,
        totals(
          incomes.filter((l) => l.currency === cur),
          commitments.filter((l) => l.currency === cur),
          (l) => l.amount,
        ),
      ]),
    ) as Record<Currency, Totals>;

    // Conversion with the rate in force on each line's date (rule 6); a missing rate leaves
    // the converted totals empty instead of failing the whole projection.
    let ars: Totals | null = null;
    let usd: Totals | null = null;
    let installmentLoad: MonthProjection['installmentLoad'] = null;
    try {
      const toCurrency = (target: Currency) => (l: { amount: Money; currency: Currency; date: string | null }) =>
        convert(l.amount, l.currency, target, input.rates, l.date ?? period);
      ars = totals(incomes, commitments, toCurrency('ARS'));
      usd = totals(incomes, commitments, toCurrency('USD'));
      const installments = [
        ...cardInstallments(input.rules, period).map((i) => ({ ...i, date: null })),
        ...commitments.filter((l) => l.origin === 'loan'),
      ];
      const amountArs = installments.reduce((acc, l) => acc.plus(toCurrency('ARS')(l)), ZERO);
      installmentLoad = {
        amountArs,
        percent: ars.incomes.isZero() ? null : amountArs.dividedBy(ars.incomes).times(100),
      };
    } catch (err) {
      if (!(err instanceof MissingRateError)) throw err;
      issues.push({ kind: 'missing_rate', pair: err.pair, date: err.date, period });
    }

    result.push({ period, incomes, commitments, byCurrency, ars, usd, installmentLoad, issues });
  }
  return result;
}
