import { z } from 'zod';
import { amount, currency, dayOfMonth, decimalString, id, isoDate, period, positiveAmount, rate, text } from './common.js';
import { MAX_INSTALLMENTS } from './one-off-expense.js';

export const loanKind = z.enum(['fixed_rate', 'uva']);
export const amortizationSystem = z.enum(['french', 'german', 'american']);

/** Rate in %: numeric(9,6). */
const percent = decimalString(3, 6);
/** VAT rate in %: numeric(5,2). */
const vatPercent = decimalString(3, 2);

/** Loan (RF-22). The theoretical schedule is computed, never stored. */
export const loan = z.object({
  id,
  lender: z.string(),
  holderId: id,
  categoryId: id,
  currency,
  kind: loanKind,
  amortizationSystem,
  principal: z.string(),
  /** UVA loans only: principal in UVAs at the grant date. */
  principalUva: z.string().nullable(),
  nominalAnnualRate: z.string(),
  effectiveAnnualRate: z.string().nullable(),
  totalFinancialCost: z.string().nullable(),
  interestVatRate: z.string(),
  monthlyInsurance: z.string(),
  grantedDate: isoDate,
  installmentsTotal: z.number(),
  firstPeriod: period,
  dueDay: z.number(),
  quotedInstallment: z.string().nullable(),
  /** Computed: month of the last installment. */
  lastPeriod: period,
  /** Computed: theoretical installment 1, to compare with the one the bank quoted. */
  firstInstallment: z.string(),
  /** Computed: installment of the current month, if any (amounts in UVAs for UVA loans). */
  currentInstallment: z.object({ number: z.number(), dueDate: isoDate, total: z.string() }).nullable(),
  /**
   * Computed: theoretical principal still owed at the start of the current month (RF-25).
   * It becomes "after the last paid installment" once payments are loaded (E2).
   */
  remainingPrincipal: z.string(),
});
export type Loan = z.infer<typeof loan>;

const fields = {
  lender: text(80),
  holderId: id,
  categoryId: id,
  currency,
  kind: loanKind,
  amortizationSystem,
  principal: positiveAmount,
  principalUva: rate.nullable(),
  nominalAnnualRate: percent,
  effectiveAnnualRate: percent.nullable(),
  totalFinancialCost: percent.nullable(),
  interestVatRate: vatPercent,
  monthlyInsurance: amount,
  grantedDate: isoDate,
  installmentsTotal: z
    .number()
    .int({ message: 'installments' })
    .min(1, { message: 'installments' })
    .max(MAX_INSTALLMENTS * 3, { message: 'installments' }),
  firstPeriod: period,
  dueDay: dayOfMonth,
  quotedInstallment: positiveAmount.nullable(),
};

/** Principal in UVAs if and only if it is a UVA loan (database check). */
const uvaConsistent = (v: { kind?: string | undefined; principalUva?: string | null | undefined }) =>
  v.kind === undefined || v.principalUva === undefined || (v.kind === 'uva') === (v.principalUva !== null);

/** The grant date goes before the month of the first installment. */
const grantedBeforeFirst = (v: { grantedDate?: string | undefined; firstPeriod?: string | undefined }) =>
  !v.grantedDate || !v.firstPeriod || v.grantedDate.slice(0, 7) <= v.firstPeriod.slice(0, 7);

export const loanCreate = z
  .object(fields)
  .refine(uvaConsistent, { message: 'uva_principal', path: ['principalUva'] })
  .refine(grantedBeforeFirst, { message: 'range', path: ['firstPeriod'] });
export type LoanCreate = z.infer<typeof loanCreate>;

export const loanUpdate = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine(uvaConsistent, { message: 'uva_principal', path: ['principalUva'] })
  .refine(grantedBeforeFirst, { message: 'range', path: ['firstPeriod'] });
export type LoanUpdate = z.infer<typeof loanUpdate>;

/** One row of the theoretical schedule (amounts in pesos, or in UVAs for UVA loans). */
export const scheduleRow = z.object({
  number: z.number(),
  period,
  dueDate: isoDate,
  days: z.number(),
  openingBalance: z.string(),
  principal: z.string(),
  interest: z.string(),
  vat: z.string(),
  insurance: z.string(),
  total: z.string(),
  closingBalance: z.string(),
});
export type ScheduleRow = z.infer<typeof scheduleRow>;

export const loanSchedule = z.object({
  /** 'UVA' when the amounts are in UVAs, else the loan currency. */
  unit: z.string(),
  rows: z.array(scheduleRow),
});
export type LoanSchedule = z.infer<typeof loanSchedule>;
