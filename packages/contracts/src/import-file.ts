import { z } from 'zod';
import { amount, country, currency, currencyPair, dayOfMonth, decimalString, everyMonths, isoDate, monthOfYear, period, positiveAmount, rate, text } from './common.js';
import { categoryKind } from './category.js';
import { amortizationSystem, loanKind } from './loan.js';
import { expenseClass } from './recurring-expense.js';

/**
 * Initial load file (RNF-15, plan decision 3). Claude reads the latest statements and notices
 * and writes this JSON; `pnpm --filter @meta31/worker run initial-load <file>` loads it through the same
 * use cases as the API, in one transaction. References go by name (category, person, property),
 * since whoever writes the file does not know the database ids.
 */

const name = text(160);
const amountsFrom = z.array(z.object({ fromPeriod: period, amount: positiveAmount })).min(1, { message: 'required' });

const installmentPurchase = z
  .object({
    description: name,
    category: name,
    purchaseDate: isoDate,
    currency,
    installmentAmount: positiveAmount,
    installmentsTotal: z.number().int().min(1),
    /** Statement where installment 1 falls… */
    firstPeriod: period.optional(),
    /** …or, as the latest statement shows it: "4 de 12" in October → { number: 4, period: October }. */
    currentInstallment: z.object({ number: z.number().int().min(1), period }).optional(),
  })
  .refine((v) => (v.firstPeriod === undefined) !== (v.currentInstallment === undefined), {
    message: 'required',
    path: ['firstPeriod'],
  });

export const importFile = z.object({
  version: z.literal(1),
  /** Created if missing (by name and kind). */
  categories: z.array(z.object({ name, kind: categoryKind })).default([]),
  properties: z.array(z.object({ name, country, currency })).default([]),
  exchangeRates: z.array(z.object({ pair: currencyPair, validFrom: isoDate, rate })).default([]),
  incomeSources: z
    .array(
      z.object({
        name,
        category: name,
        holder: name.nullable().default(null),
        property: name.nullable().default(null),
        currency,
        everyMonths: everyMonths.default(1),
        anchorMonth: monthOfYear.default(1),
        expectedDay: dayOfMonth.nullable().default(null),
        validFrom: period,
        validTo: period.nullable().default(null),
        /** Amount history, oldest first; the first one is in force from `validFrom`. */
        amounts: amountsFrom,
      }),
    )
    .default([]),
  oneOffIncomes: z
    .array(
      z.object({
        description: name,
        category: name,
        period,
        expectedDate: isoDate.nullable().default(null),
        currency,
        estimatedAmount: positiveAmount,
      }),
    )
    .default([]),
  recurringExpenses: z
    .array(
      z.object({
        name,
        class: expenseClass,
        provider: name.nullable().default(null),
        category: name,
        property: name.nullable().default(null),
        beneficiary: name.nullable().default(null),
        currency,
        everyMonths: everyMonths.default(1),
        anchorMonth: monthOfYear.default(1),
        dueDay: dayOfMonth.nullable().default(null),
        validFrom: period,
        validTo: period.nullable().default(null),
        amounts: amountsFrom,
      }),
    )
    .default([]),
  oneOffExpenses: z
    .array(
      z.object({
        description: name,
        category: name,
        property: name.nullable().default(null),
        currency,
        totalAmount: positiveAmount,
        installments: z.number().int().min(1).default(1),
        firstPeriod: period,
        plannedDate: isoDate.nullable().default(null),
      }),
    )
    .default([]),
  creditCards: z
    .array(
      z.object({
        name,
        bank: name,
        country,
        holder: name,
        closingDay: dayOfMonth,
        dueDay: dayOfMonth,
        estimatedSpendLocal: amount.default('0'),
        estimatedSpendUsd: amount.default('0'),
        installmentPurchases: z.array(installmentPurchase).default([]),
        subscriptions: z
          .array(
            z.object({
              description: name,
              category: name,
              currency,
              amount: positiveAmount,
              validFrom: isoDate,
              validTo: isoDate.nullable().default(null),
            }),
          )
          .default([]),
        statements: z
          .array(
            z.object({
              closingDate: isoDate,
              dueDate: isoDate,
              previousBalanceLocal: amount.default('0'),
              previousBalanceUsd: amount.default('0'),
              totalLocal: amount,
              totalUsd: amount.default('0'),
              minimumPaymentLocal: amount,
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  loans: z
    .array(
      z.object({
        lender: name,
        holder: name,
        category: name,
        currency,
        kind: loanKind.default('fixed_rate'),
        amortizationSystem: amortizationSystem.default('french'),
        principal: positiveAmount,
        principalUva: rate.nullable().default(null),
        nominalAnnualRate: decimalString(3, 6),
        effectiveAnnualRate: decimalString(3, 6).nullable().default(null),
        totalFinancialCost: decimalString(3, 6).nullable().default(null),
        interestVatRate: decimalString(3, 2).default('0'),
        monthlyInsurance: amount.default('0'),
        grantedDate: isoDate,
        installmentsTotal: z.number().int().min(1),
        firstPeriod: period,
        dueDay: dayOfMonth,
        quotedInstallment: positiveAmount.nullable().default(null),
      }),
    )
    .default([]),
});
export type ImportFile = z.infer<typeof importFile>;
export type ImportFileInput = z.input<typeof importFile>;
