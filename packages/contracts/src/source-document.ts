import { z } from 'zod';
import { cardStatementCreate } from './card-statement.js';
import { MAX_INSTALLMENTS } from './one-off-expense.js';
import { cardTransactionFields } from './card-transaction.js';
import { currency, id, isoDate, period, positiveAmount, text } from './common.js';
import { cardPaymentInput, paymentCreate } from './payment.js';

export const documentKind = z.enum(['card_statement', 'utility_bill', 'loan_notice', 'tax', 'condo_fee', 'payment_receipt', 'other']);
export type DocumentKind = z.infer<typeof documentKind>;

/** Inbox = pending_review and unrecognized (D3). */
export const documentStatus = z.enum(['pending_review', 'unrecognized', 'confirmed', 'discarded']);
export type DocumentStatus = z.infer<typeof documentStatus>;

/** Real amount of a recurring expense's bill in a month (the month of its origin). */
const recurringBill = z.object({
  recurringExpenseId: id,
  period,
  actualAmount: positiveAmount,
  /** Use it as the estimate from the next month on (RF-19). */
  updateFollowing: z.boolean().default(false),
});

/** A short label Claude gives to a new item, so the statement's lines can point to it before it exists. */
const ref = z.string().trim().min(1, { message: 'required' }).max(40);

/**
 * An installment purchase that shows up for the first time in a statement (decision of 5/10):
 * created when the statement is confirmed. Its first month comes from the line that points to it
 * (the statement's month minus the installment number − 1).
 */
export const newInstallmentPurchase = z.object({
  ref,
  description: text(160),
  categoryId: id,
  purchaseDate: isoDate,
  currency,
  installmentAmount: positiveAmount,
  installmentsTotal: z.number().int({ message: 'installments' }).min(1, { message: 'installments' }).max(MAX_INSTALLMENTS, { message: 'installments' }),
});
export type NewInstallmentPurchase = z.infer<typeof newInstallmentPurchase>;

/** A subscription or automatic debit that shows up for the first time in a statement: created on confirmation. */
export const newSubscription = z.object({ ref, description: text(160), categoryId: id, currency, amount: positiveAmount, validFrom: isoDate });
export type NewSubscription = z.infer<typeof newSubscription>;

/** A line read from a statement: like a breakdown line, or pointing to a new item by its `ref`. */
export const statementLine = z
  .object({
    ...cardTransactionFields,
    installmentPurchaseId: id.nullable().default(null),
    installmentNumber: cardTransactionFields.installmentNumber.default(null),
    subscriptionId: id.nullable().default(null),
    installmentPurchaseRef: ref.nullable().default(null),
    subscriptionRef: ref.nullable().default(null),
  })
  .refine((v) => !(v.installmentPurchaseId && v.installmentPurchaseRef) && !(v.subscriptionId && v.subscriptionRef), {
    message: 'choice',
    path: ['installmentPurchaseRef'],
  })
  // an installment line points to its purchase (existing or new) and says which installment it is
  .refine((v) => (v.installmentPurchaseId === null && v.installmentPurchaseRef === null) === (v.installmentNumber === null), {
    message: 'required',
    path: ['installmentNumber'],
  });
export type StatementLine = z.infer<typeof statementLine>;

/** Refs are unique, every line's ref exists, and every new purchase has a line that says its installment. */
function checkNewItems(
  v: { newInstallmentPurchases: { ref: string }[]; newSubscriptions: { ref: string }[]; transactions: { installmentPurchaseRef: string | null; subscriptionRef: string | null }[] },
  ctx: z.RefinementCtx,
) {
  const purchases = v.newInstallmentPurchases.map((p) => p.ref);
  const subscriptions = v.newSubscriptions.map((s) => s.ref);
  const all = [...purchases, ...subscriptions];
  all.forEach((r, i) => {
    if (all.indexOf(r) !== i) ctx.addIssue({ code: 'custom', message: 'duplicate', path: [i < purchases.length ? 'newInstallmentPurchases' : 'newSubscriptions'] });
  });
  v.transactions.forEach((t, i) => {
    if (t.installmentPurchaseRef !== null && !purchases.includes(t.installmentPurchaseRef))
      ctx.addIssue({ code: 'custom', message: 'invalid_reference', path: ['transactions', i, 'installmentPurchaseRef'] });
    if (t.subscriptionRef !== null && !subscriptions.includes(t.subscriptionRef))
      ctx.addIssue({ code: 'custom', message: 'invalid_reference', path: ['transactions', i, 'subscriptionRef'] });
  });
  v.newInstallmentPurchases.forEach((p, i) => {
    if (!v.transactions.some((t) => t.installmentPurchaseRef === p.ref))
      ctx.addIssue({ code: 'custom', message: 'required', path: ['newInstallmentPurchases', i, 'ref'] });
  });
}

/**
 * The domain operations Claude can propose (RF-35, D3), each with the input it takes. Confirming
 * a document runs its operation through the same use cases as the PWA.
 */
export const operationPayloads = {
  /** A real card statement with its totals and, optionally, every line of its breakdown (RF-11, RF-12). */
  load_card_statement: z
    .object({
      statement: cardStatementCreate,
      /** Installment purchases and subscriptions first seen in this statement, created with it. */
      newInstallmentPurchases: z.array(newInstallmentPurchase).max(50).default([]),
      newSubscriptions: z.array(newSubscription).max(50).default([]),
      transactions: z.array(statementLine).max(400).default([]),
    })
    .superRefine(checkNewItems),
  record_utility_bill: recurringBill,
  record_tax: recurringBill,
  record_condo_fee: recurringBill,
  /** Real amount of a loan installment, the installment due in `period` (RF-23). */
  record_loan_installment: z.object({ loanId: id, period, actualAmount: positiveAmount }),
  /**
   * A payment receipt: it pays the commitment that already exists for that month (never a new
   * expense) — a recurring expense's or a loan installment's.
   */
  register_payment: z
    .object({ recurringExpenseId: id.nullable().default(null), loanId: id.nullable().default(null), period, payment: paymentCreate })
    .refine((v) => (v.recurringExpenseId === null) !== (v.loanId === null), { message: 'required', path: ['recurringExpenseId'] }),
  /** A card payment receipt (RF-15): pays the statement of that month, local and USD parts. */
  register_card_payment: z.object({ creditCardId: id, payment: cardPaymentInput }),
} as const;

export const documentOperation = z.enum(Object.keys(operationPayloads) as [keyof typeof operationPayloads, ...(keyof typeof operationPayloads)[]]);
export type DocumentOperation = z.infer<typeof documentOperation>;
export type OperationPayload<O extends DocumentOperation> = z.output<(typeof operationPayloads)[O]>;

/** The operations that fit each kind of document. */
export const OPERATIONS_BY_KIND: Record<DocumentKind, readonly DocumentOperation[]> = {
  card_statement: ['load_card_statement'],
  utility_bill: ['record_utility_bill'],
  loan_notice: ['record_loan_installment'],
  tax: ['record_tax'],
  condo_fee: ['record_condo_fee'],
  payment_receipt: ['register_payment', 'register_card_payment'],
  other: [],
};

/** Checks the payload against its operation's input, reporting issues under `payload.…`. */
function checkOperation(v: { kind?: DocumentKind; operation: DocumentOperation | null; payload?: unknown }, ctx: z.RefinementCtx) {
  if (v.operation === null) return;
  if (v.kind && !OPERATIONS_BY_KIND[v.kind].includes(v.operation)) {
    ctx.addIssue({ code: 'custom', message: 'choice', path: ['operation'] });
    return;
  }
  const r = operationPayloads[v.operation].safeParse(v.payload);
  if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: ['payload', ...issue.path] } as never);
}

/**
 * What Claude proposes from a document (D3). With an operation it goes to review; without one
 * (it did not recognize the card, the service…) it goes to the inbox as unrecognized, with the reason.
 */
export const documentProposal = z
  .object({
    fileName: z.string().trim().min(1, { message: 'required' }).max(260),
    /** SHA-256 of the file, hex: the same file twice is refused. */
    fileHash: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[0-9a-f]{64}$/, { message: 'invalid' }),
    kind: documentKind,
    operation: documentOperation.nullable(),
    payload: z.unknown().optional(),
    reason: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.operation === null && !v.reason) ctx.addIssue({ code: 'custom', message: 'required', path: ['reason'] });
    checkOperation(v, ctx);
  });
export type DocumentProposal = z.input<typeof documentProposal>;

/** Correcting a document before confirming it: its operation and data (an unrecognized one goes to review). */
export const documentCorrection = z
  .object({ operation: documentOperation, payload: z.unknown() })
  .superRefine((v, ctx) => checkOperation(v, ctx));
export type DocumentCorrection = z.input<typeof documentCorrection>;

export const documentDiscard = z.object({ reason: z.string().trim().max(500).nullable().default(null) });
export type DocumentDiscard = z.input<typeof documentDiscard>;

export const sourceDocument = z.object({
  id,
  fileName: z.string(),
  kind: documentKind,
  operation: documentOperation.nullable(),
  payload: z.unknown(),
  status: documentStatus,
  reason: z.string().nullable(),
  uploadedBy: z.object({ id, name: z.string() }),
  reviewedBy: z.object({ id, name: z.string() }).nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SourceDocument = z.infer<typeof sourceDocument>;

export const documentListQuery = z.object({ status: z.enum(['inbox', 'confirmed', 'discarded']).default('inbox') });
