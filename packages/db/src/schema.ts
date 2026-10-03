// Schema de la base. Fuente de verdad: docs/modelo-de-datos.md (21 tablas).
// Nombres en inglés; Drizzle mapea camelCase → snake_case (casing: 'snake_case').
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums (sección 5)
// ---------------------------------------------------------------------------

export const currency = pgEnum('currency', ['ARS', 'USD', 'UYU']);
export const country = pgEnum('country', ['AR', 'UY']);
export const currencyPair = pgEnum('currency_pair', ['USD_ARS', 'UYU_USD']);
export const indexKind = pgEnum('index_kind', ['cpi', 'uva']);
export const entryMode = pgEnum('entry_mode', ['manual', 'claude']);
export const categoryKind = pgEnum('category_kind', ['income', 'expense']);
export const monthStatus = pgEnum('month_status', ['open', 'closed']);
export const incomeStatus = pgEnum('income_status', ['expected', 'received', 'cancelled']);
export const commitmentStatus = pgEnum('commitment_status', [
  'pending',
  'partially_paid',
  'paid',
  'cancelled',
]);
export const expenseClass = pgEnum('expense_class', [
  'utility',
  'tax',
  'condo_fee',
  'recurring',
  'budget',
]);
export const cardTransactionKind = pgEnum('card_transaction_kind', [
  'purchase',
  'installment',
  'subscription',
  'interest',
  'admin_fee',
  'tax',
  'payment',
  'adjustment',
]);
export const loanKind = pgEnum('loan_kind', ['fixed_rate', 'uva']);
export const amortizationSystem = pgEnum('amortization_system', ['french', 'german', 'american']);
export const paymentMethod = pgEnum('payment_method', [
  'transfer',
  'debit',
  'cash',
  'mercado_pago',
  'other',
]);
export const documentKind = pgEnum('document_kind', [
  'card_statement',
  'utility_bill',
  'loan_notice',
  'tax',
  'condo_fee',
  'payment_receipt',
  'other',
]);
export const documentStatus = pgEnum('document_status', [
  'pending_review',
  'unrecognized',
  'confirmed',
  'discarded',
]);

// ---------------------------------------------------------------------------
// Tipos de columna (RNF-10)
// ---------------------------------------------------------------------------

/** Importe: numeric(14,2). Drizzle lo devuelve como string → Decimal en el borde. */
const amount = () => numeric({ precision: 14, scale: 2 });
/** Cotización o índice: numeric(14,6). */
const rate = () => numeric({ precision: 14, scale: 6 });
/** Tasa en %: numeric(9,6). */
const percent = () => numeric({ precision: 9, scale: 6 });
/** Fecha sin hora, como string 'YYYY-MM-DD'. */
const day = () => date({ mode: 'string' });
const id = () => uuid().primaryKey().defaultRandom();

/** Check D6: un período es una fecha con día 1. */
const firstDay = (name: string, column: AnyPgColumn) =>
  check(name, sql`extract(day from ${column}) = 1`);
/** Check D7: periodicidad válida. */
const periodicity = (prefix: string, everyMonths: AnyPgColumn, anchorMonth: AnyPgColumn) => [
  check(`${prefix}_every_months_check`, sql`${everyMonths} in (1, 2, 3, 6, 12)`),
  check(`${prefix}_anchor_month_check`, sql`${anchorMonth} between 1 and 12`),
];

// ---------------------------------------------------------------------------
// Auditoría (RF-01). Va en todas las tablas salvo source_document, que es el
// comprobante mismo y tiene sus propias columnas (uploaded_by, reviewed_by).
// created_by/updated_by admiten null para lo que carga el sistema (seed, scripts).
// ---------------------------------------------------------------------------

const audit = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid().references((): AnyPgColumn => person.id),
  updatedBy: uuid().references((): AnyPgColumn => person.id),
  entryMode: entryMode().notNull().default('manual'),
  sourceDocumentId: uuid().references((): AnyPgColumn => sourceDocument.id),
});

// ---------------------------------------------------------------------------
// 4.1 Base
// ---------------------------------------------------------------------------

export const person = pgTable('person', {
  id: id(),
  name: text().notNull(),
  email: text().unique('person_email_unique'),
  isUser: boolean().notNull().default(false),
  ...audit(),
}).enableRLS();

export const category = pgTable(
  'category',
  {
    id: id(),
    name: text().notNull(),
    kind: categoryKind().notNull(),
    active: boolean().notNull().default(true),
    ...audit(),
  },
  (t) => [unique('category_name_kind_unique').on(t.name, t.kind)],
).enableRLS();

export const property = pgTable('property', {
  id: id(),
  name: text().notNull(),
  country: country().notNull(),
  currency: currency().notNull(),
  active: boolean().notNull().default(true),
  ...audit(),
}).enableRLS();

export const exchangeRate = pgTable(
  'exchange_rate',
  {
    id: id(),
    pair: currencyPair().notNull(),
    validFrom: day().notNull(),
    rate: rate().notNull(),
    ...audit(),
  },
  (t) => [
    unique('exchange_rate_pair_valid_from_unique').on(t.pair, t.validFrom),
    check('exchange_rate_rate_check', sql`${t.rate} > 0`),
  ],
).enableRLS();

export const economicIndex = pgTable(
  'economic_index',
  {
    id: id(),
    kind: indexKind().notNull(),
    date: day().notNull(),
    value: rate().notNull(),
    ...audit(),
  },
  (t) => [unique('economic_index_kind_date_unique').on(t.kind, t.date)],
).enableRLS();

export const month = pgTable(
  'month',
  {
    period: day().primaryKey(),
    status: monthStatus().notNull().default('open'),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    openedBy: uuid().references((): AnyPgColumn => person.id),
    closedAt: timestamp({ withTimezone: true }),
    closedBy: uuid().references((): AnyPgColumn => person.id),
    ...audit(),
  },
  (t) => [firstDay('month_period_check', t.period)],
).enableRLS();

// ---------------------------------------------------------------------------
// 4.2 Ingresos
// ---------------------------------------------------------------------------

export const incomeSource = pgTable(
  'income_source',
  {
    id: id(),
    name: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    holderId: uuid().references(() => person.id),
    propertyId: uuid().references(() => property.id),
    currency: currency().notNull(),
    everyMonths: smallint().notNull().default(1),
    anchorMonth: smallint().notNull().default(1),
    expectedDay: smallint(),
    validFrom: day().notNull(),
    validTo: day(),
    ...audit(),
  },
  (t) => [
    ...periodicity('income_source', t.everyMonths, t.anchorMonth),
    firstDay('income_source_valid_from_check', t.validFrom),
    check('income_source_expected_day_check', sql`${t.expectedDay} between 1 and 31`),
  ],
).enableRLS();

export const incomeSourceAmount = pgTable(
  'income_source_amount',
  {
    id: id(),
    incomeSourceId: uuid()
      .notNull()
      .references(() => incomeSource.id),
    fromPeriod: day().notNull(),
    amount: amount().notNull(),
    ...audit(),
  },
  (t) => [
    unique('income_source_amount_income_source_id_from_period_unique').on(t.incomeSourceId, t.fromPeriod),
    firstDay('income_source_amount_from_period_check', t.fromPeriod),
  ],
).enableRLS();

export const income = pgTable(
  'income',
  {
    id: id(),
    incomeSourceId: uuid().references(() => incomeSource.id),
    sourceKey: text().unique('income_source_key_unique'),
    description: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    period: day().notNull(),
    expectedDate: day(),
    currency: currency().notNull(),
    estimatedAmount: amount().notNull(),
    actualAmount: amount(),
    receivedDate: day(),
    appliedRate: rate(),
    status: incomeStatus().notNull().default('expected'),
    ...audit(),
  },
  (t) => [
    firstDay('income_period_check', t.period),
    index('income_period_status_idx').on(t.period, t.status),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// 4.3 Tarjetas
// ---------------------------------------------------------------------------

export const creditCard = pgTable(
  'credit_card',
  {
    id: id(),
    name: text().notNull(),
    bank: text().notNull(),
    country: country().notNull(),
    holderId: uuid()
      .notNull()
      .references(() => person.id),
    localCurrency: currency().notNull(),
    closingDay: smallint().notNull(),
    dueDay: smallint().notNull(),
    estimatedSpendLocal: amount().notNull().default('0'),
    estimatedSpendUsd: amount().notNull().default('0'),
    active: boolean().notNull().default(true),
    ...audit(),
  },
  (t) => [
    check('credit_card_local_currency_check', sql`${t.localCurrency} in ('ARS', 'UYU')`),
    check('credit_card_closing_day_check', sql`${t.closingDay} between 1 and 31`),
    check('credit_card_due_day_check', sql`${t.dueDay} between 1 and 31`),
  ],
).enableRLS();

export const cardStatement = pgTable(
  'card_statement',
  {
    id: id(),
    creditCardId: uuid()
      .notNull()
      .references(() => creditCard.id),
    period: day().notNull(),
    closingDate: day().notNull(),
    dueDate: day().notNull(),
    previousBalanceLocal: amount().notNull().default('0'),
    previousBalanceUsd: amount().notNull().default('0'),
    totalLocal: amount().notNull(),
    totalUsd: amount().notNull(),
    minimumPaymentLocal: amount().notNull(),
    ...audit(),
  },
  (t) => [
    unique('card_statement_credit_card_id_period_unique').on(t.creditCardId, t.period),
    firstDay('card_statement_period_check', t.period),
  ],
).enableRLS();

export const installmentPurchase = pgTable(
  'installment_purchase',
  {
    id: id(),
    creditCardId: uuid()
      .notNull()
      .references(() => creditCard.id),
    description: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    purchaseDate: day().notNull(),
    currency: currency().notNull(),
    installmentAmount: amount().notNull(),
    installmentsTotal: smallint().notNull(),
    firstPeriod: day().notNull(),
    ...audit(),
  },
  (t) => [
    firstDay('installment_purchase_first_period_check', t.firstPeriod),
    check('installment_purchase_installments_total_check', sql`${t.installmentsTotal} >= 1`),
  ],
).enableRLS();

export const subscription = pgTable(
  'subscription',
  {
    id: id(),
    creditCardId: uuid()
      .notNull()
      .references(() => creditCard.id),
    description: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    currency: currency().notNull(),
    amount: amount().notNull(),
    validFrom: day().notNull(),
    validTo: day(),
    ...audit(),
  },
  (t) => [index('subscription_credit_card_idx').on(t.creditCardId)],
).enableRLS();

export const cardTransaction = pgTable(
  'card_transaction',
  {
    id: id(),
    cardStatementId: uuid()
      .notNull()
      .references(() => cardStatement.id),
    kind: cardTransactionKind().notNull(),
    date: day(),
    description: text().notNull(),
    categoryId: uuid().references(() => category.id),
    currency: currency().notNull(),
    amount: amount().notNull(),
    installmentPurchaseId: uuid().references(() => installmentPurchase.id),
    installmentNumber: smallint(),
    subscriptionId: uuid().references(() => subscription.id),
    ...audit(),
  },
  (t) => [index('card_transaction_card_statement_idx').on(t.cardStatementId)],
).enableRLS();

// ---------------------------------------------------------------------------
// 4.4 Gastos
// ---------------------------------------------------------------------------

export const recurringExpense = pgTable(
  'recurring_expense',
  {
    id: id(),
    name: text().notNull(),
    class: expenseClass().notNull(),
    provider: text(),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    propertyId: uuid().references(() => property.id),
    beneficiaryId: uuid().references(() => person.id),
    currency: currency().notNull(),
    everyMonths: smallint().notNull().default(1),
    anchorMonth: smallint().notNull().default(1),
    dueDay: smallint(),
    validFrom: day().notNull(),
    validTo: day(),
    ...audit(),
  },
  (t) => [
    ...periodicity('recurring_expense', t.everyMonths, t.anchorMonth),
    check('recurring_expense_due_day_check', sql`${t.dueDay} between 1 and 31`),
  ],
).enableRLS();

export const recurringExpenseAmount = pgTable(
  'recurring_expense_amount',
  {
    id: id(),
    recurringExpenseId: uuid()
      .notNull()
      .references(() => recurringExpense.id),
    fromPeriod: day().notNull(),
    amount: amount().notNull(),
    ...audit(),
  },
  (t) => [
    unique('recurring_expense_amount_recurring_expense_id_from_period_unique').on(t.recurringExpenseId, t.fromPeriod),
    firstDay('recurring_expense_amount_from_period_check', t.fromPeriod),
  ],
).enableRLS();

export const oneOffExpense = pgTable(
  'one_off_expense',
  {
    id: id(),
    description: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    propertyId: uuid().references(() => property.id),
    currency: currency().notNull(),
    totalAmount: amount().notNull(),
    installments: smallint().notNull().default(1),
    firstPeriod: day().notNull(),
    plannedDate: day(),
    ...audit(),
  },
  (t) => [
    firstDay('one_off_expense_first_period_check', t.firstPeriod),
    check('one_off_expense_installments_check', sql`${t.installments} >= 1`),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// 4.5 Préstamos
// ---------------------------------------------------------------------------

export const loan = pgTable(
  'loan',
  {
    id: id(),
    lender: text().notNull(),
    holderId: uuid()
      .notNull()
      .references(() => person.id),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    currency: currency().notNull(),
    kind: loanKind().notNull(),
    amortizationSystem: amortizationSystem().notNull(),
    principal: amount().notNull(),
    principalUva: rate(),
    nominalAnnualRate: percent().notNull(),
    effectiveAnnualRate: percent(),
    totalFinancialCost: percent(),
    interestVatRate: numeric({ precision: 5, scale: 2 }).notNull().default('0'),
    monthlyInsurance: amount().notNull().default('0'),
    grantedDate: day().notNull(),
    installmentsTotal: smallint().notNull(),
    firstPeriod: day().notNull(),
    dueDay: smallint().notNull(),
    quotedInstallment: amount(),
    ...audit(),
  },
  (t) => [
    firstDay('loan_first_period_check', t.firstPeriod),
    check('loan_installments_total_check', sql`${t.installmentsTotal} >= 1`),
    check('loan_due_day_check', sql`${t.dueDay} between 1 and 31`),
    check(
      'loan_principal_uva_check',
      sql`(${t.kind} = 'uva') = (${t.principalUva} is not null)`,
    ),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// 4.6 Compromisos
// ---------------------------------------------------------------------------

export const commitment = pgTable(
  'commitment',
  {
    id: id(),
    sourceKey: text().unique('commitment_source_key_unique'),
    creditCardId: uuid().references(() => creditCard.id),
    recurringExpenseId: uuid().references(() => recurringExpense.id),
    oneOffExpenseId: uuid().references(() => oneOffExpense.id),
    loanId: uuid().references(() => loan.id),
    installmentNumber: smallint(),
    parentCommitmentId: uuid().references((): AnyPgColumn => commitment.id),
    description: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
    originPeriod: day().notNull(),
    period: day().notNull(),
    dueDate: day(),
    currency: currency().notNull(),
    estimatedAmount: amount().notNull(),
    actualAmount: amount(),
    surcharge: amount().notNull().default('0'),
    status: commitmentStatus().notNull().default('pending'),
    cancellationReason: text(),
    ...audit(),
  },
  (t) => [
    firstDay('commitment_period_check', t.period),
    firstDay('commitment_origin_period_check', t.originPeriod),
    check(
      'commitment_single_origin_check',
      sql`num_nonnulls(${t.creditCardId}, ${t.recurringExpenseId}, ${t.oneOffExpenseId}, ${t.loanId}) = 1`,
    ),
    index('commitment_period_status_idx').on(t.period, t.status),
    index('commitment_origin_period_idx').on(t.originPeriod),
  ],
).enableRLS();

export const commitmentPayment = pgTable(
  'commitment_payment',
  {
    id: id(),
    commitmentId: uuid()
      .notNull()
      .references(() => commitment.id),
    date: day().notNull(),
    paymentCurrency: currency().notNull(),
    amountPaid: amount().notNull(),
    appliedRate: rate(),
    allocatedAmount: amount().notNull(),
    paymentMethod: paymentMethod().notNull(),
    ...audit(),
  },
  (t) => [index('commitment_payment_commitment_idx').on(t.commitmentId)],
).enableRLS();

// ---------------------------------------------------------------------------
// 4.7 Carga por Claude
// ---------------------------------------------------------------------------

export const sourceDocument = pgTable('source_document', {
  id: id(),
  fileName: text().notNull(),
  fileHash: text().notNull().unique('source_document_file_hash_unique'),
  kind: documentKind().notNull(),
  operation: text(),
  payload: jsonb(),
  status: documentStatus().notNull().default('pending_review'),
  reason: text(),
  uploadedBy: uuid()
    .notNull()
    .references((): AnyPgColumn => person.id),
  reviewedBy: uuid().references((): AnyPgColumn => person.id),
  reviewedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();
