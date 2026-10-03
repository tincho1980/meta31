import { Money } from './money.js';
import { addMonths, dateInPeriod, daysBetween, type Period, periodOf, toPeriod } from './period.js';

export type AmortizationSystem = 'french' | 'german' | 'american';

/** Loan conditions needed to compute the theoretical schedule (table `loan`). */
export type LoanTerms = {
  system: AmortizationSystem;
  /** Principal in pesos, or in UVAs for UVA loans (then every amount comes out in UVAs). */
  principal: Money;
  /** Nominal annual rate (TNA) in %, as in the contract (79 = 79 %). */
  nominalAnnualRate: Money;
  /** VAT on interest, in % (0 if none). */
  interestVatRate: Money;
  /** Fixed charge per installment (life insurance or similar). */
  monthlyInsurance: Money;
  /** Grant date 'YYYY-MM-DD': the first interest period starts here. */
  grantedDate: string;
  /** Period of installment 1. */
  firstPeriod: string;
  /** Due day of the month; 31 (or more than the month has) means the last day. */
  dueDay: number;
  installmentsTotal: number;
};

export type ScheduleRow = {
  number: number;
  period: Period;
  dueDate: string;
  /** Days of interest: from the grant date (installment 1) or the previous due date. */
  days: number;
  openingBalance: Money;
  principal: Money;
  interest: Money;
  vat: Money;
  insurance: Money;
  total: Money;
  closingBalance: Money;
};

const DAYS_PER_YEAR = 365;
/** Decimals of the period rate (TNA × days / 365), as the bank rounds it before applying it. */
const PERIOD_RATE_DECIMALS = 8;
const cents = (x: Money) => x.toDecimalPlaces(2, Money.ROUND_HALF_UP);
const centsDown = (x: Money) => x.toDecimalPlaces(2, Money.ROUND_DOWN);

/**
 * Principal portion of each installment, before rounding, by system:
 * - french: the textbook French table with monthly rate TNA/12 (constant pure installment);
 * - german: constant principal (principal / n);
 * - american: all the principal in the last installment.
 */
function principalPortions(terms: LoanTerms): Money[] {
  const n = terms.installmentsTotal;
  const p = terms.principal;
  switch (terms.system) {
    case 'german':
      return Array.from({ length: n }, () => p.dividedBy(n));
    case 'american':
      return Array.from({ length: n }, (_, k) => (k === n - 1 ? p : new Money(0)));
    case 'french': {
      const i = terms.nominalAnnualRate.dividedBy(100).dividedBy(12);
      if (i.isZero()) return Array.from({ length: n }, () => p.dividedBy(n));
      const pure = p.times(i).dividedBy(new Money(1).minus(i.plus(1).pow(-n)));
      const portions: Money[] = [];
      let balance = p;
      for (let k = 0; k < n; k++) {
        const portion = pure.minus(balance.times(i));
        portions.push(portion);
        balance = balance.minus(portion);
      }
      return portions;
    }
  }
}

/**
 * Theoretical amortization schedule (RF-23). It is never stored: it is recomputed from the terms.
 *
 * Convention, validated to the cent against a real bank personal loan:
 * principal follows the system (French: textbook table at TNA/12), while interest is
 * charged for the actual days of each period at TNA/365 on the outstanding balance.
 * That is why installments vary with the length of the month and the first one is larger
 * when the grant date is more than a month before the first due date.
 *
 * Rounding, derived from the bank's figures (the only convention that reproduces all of them):
 * the period rate TNA × days / 365 is rounded to 8 decimals, interest = balance × period rate
 * truncated to cents, principal rounded half-up to cents. The last installment's principal is
 * the remaining balance, so it absorbs the rounding and the loan ends exactly at zero.
 */
export function amortizationSchedule(terms: LoanTerms): ScheduleRow[] {
  const n = terms.installmentsTotal;
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Invalid installment total: ${n}`);
  if (terms.principal.lte(0)) throw new RangeError('Principal must be positive');
  if (terms.nominalAnnualRate.lt(0)) throw new RangeError('Rate cannot be negative');
  const first = toPeriod(terms.firstPeriod);
  const firstDue = dateInPeriod(first, terms.dueDay);
  if (daysBetween(terms.grantedDate, firstDue) <= 0) {
    throw new RangeError(`First due date ${firstDue} must be after the grant date ${terms.grantedDate}`);
  }

  const annualRate = terms.nominalAnnualRate.dividedBy(100);
  const vatRate = terms.interestVatRate.dividedBy(100);
  const portions = principalPortions(terms);
  const rows: ScheduleRow[] = [];
  let balance = cents(terms.principal);
  let previousDate = terms.grantedDate;

  for (let k = 0; k < n; k++) {
    const period = addMonths(first, k);
    const dueDate = dateInPeriod(period, terms.dueDay);
    const days = daysBetween(previousDate, dueDate);
    const portion = portions[k] ?? new Money(0);
    const principal = k === n - 1 ? balance : cents(portion);
    const periodRate = annualRate
      .times(days)
      .dividedBy(DAYS_PER_YEAR)
      .toDecimalPlaces(PERIOD_RATE_DECIMALS, Money.ROUND_HALF_UP);
    const interest = centsDown(balance.times(periodRate));
    const vat = cents(interest.times(vatRate));
    const insurance = cents(terms.monthlyInsurance);
    rows.push({
      number: k + 1,
      period,
      dueDate,
      days,
      openingBalance: balance,
      principal,
      interest,
      vat,
      insurance,
      total: principal.plus(interest).plus(vat).plus(insurance),
      closingBalance: balance.minus(principal),
    });
    balance = balance.minus(principal);
    previousDate = dueDate;
  }
  return rows;
}

/** Remaining debt (RF-25): theoretical principal balance after the last paid installment. */
export function remainingPrincipal(schedule: readonly ScheduleRow[], paidInstallments: number): Money {
  if (!Number.isInteger(paidInstallments) || paidInstallments < 0 || paidInstallments > schedule.length) {
    throw new RangeError(`Invalid paid installments: ${paidInstallments}`);
  }
  if (paidInstallments === 0) return schedule[0]?.openingBalance ?? new Money(0);
  return schedule[paidInstallments - 1]!.closingBalance;
}

/**
 * Installment matching a due date (or any date in its month). Bank notices are matched
 * by date, never by number: banks may number installments differently (some count
 * the disbursement as installment 1).
 */
export function installmentForDate(schedule: readonly ScheduleRow[], date: string): ScheduleRow | null {
  const period = periodOf(date);
  return schedule.find((row) => row.period === period) ?? null;
}

/** Deviation of the actual installment from the theoretical one (RF-23), in amount and %. */
export function installmentDeviation(theoretical: Money, actual: Money): { amount: Money; percent: Money } {
  const amount = actual.minus(theoretical);
  const percent = theoretical.isZero() ? new Money(0) : amount.dividedBy(theoretical).times(100);
  return { amount, percent };
}

/** Converts a UVA amount to pesos with a UVA value (RF-24 re-estimates with the latest one). */
export function uvaToPesos(amountInUva: Money, uvaValue: Money): Money {
  return amountInUva.times(uvaValue);
}
