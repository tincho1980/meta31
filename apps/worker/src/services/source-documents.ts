import {
  type DocumentCorrection,
  type DocumentOperation,
  type documentDiscard,
  type documentProposal,
  operationPayloads,
  type SourceDocument,
} from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { addMonths, periodOf, sourceKey, toPeriod } from '@meta31/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { payCardStatement } from './card-payments.js';
import { createCardStatement } from './card-statements.js';
import { addCardTransaction } from './card-transactions.js';
import { setActualAmount } from './commitment-actions.js';
import { isUniqueViolation, ServiceError } from './errors.js';
import { ensureCommitment } from './open-month.js';
import { addPayment } from './payments.js';

const { cardStatement, cardTransaction, commitment, commitmentPayment, creditCard, loan, person, recurringExpense, recurringExpenseAmount, sourceDocument } =
  schema;

type Row = typeof sourceDocument.$inferSelect;
type Proposal = z.output<typeof documentProposal>;

/** Classes of recurring expense each bill operation applies to (D2). */
const BILL_CLASSES = {
  record_utility_bill: ['utility', 'recurring', 'budget'],
  record_tax: ['tax'],
  record_condo_fee: ['condo_fee'],
} as const;

const INBOX = ['pending_review', 'unrecognized'] as const;

/** Thrown inside a dry run to roll it back once the operation went through. */
class DryRun extends Error {}

/** Marks rows as loaded by Claude from this document (RF-35: every record keeps its origin). */
async function stamp(db: Db, table: typeof commitment | typeof commitmentPayment | typeof cardStatement | typeof cardTransaction | typeof recurringExpenseAmount, ids: string[], documentId: string) {
  if (ids.length === 0) return;
  await db.update(table).set({ entryMode: 'claude', sourceDocumentId: documentId }).where(inArray(table.id, ids));
}

async function paymentIds(db: Db, commitmentIds: string[]): Promise<Set<string>> {
  if (commitmentIds.length === 0) return new Set();
  const rows = await db.select({ id: commitmentPayment.id }).from(commitmentPayment).where(inArray(commitmentPayment.commitmentId, commitmentIds));
  return new Set(rows.map((r) => r.id));
}

/** Pays a commitment and stamps the new payments only: the commitment keeps the bill's document. */
async function payAndStamp(db: Db, commitmentIds: string[], pay: () => Promise<unknown>, documentId: string) {
  const before = await paymentIds(db, commitmentIds);
  await pay();
  const after = await paymentIds(db, commitmentIds);
  await stamp(db, commitmentPayment, [...after].filter((id) => !before.has(id)), documentId);
}

/** The loan installment due in a month, stored or still virtual (D1). */
const loanInstallment = (db: Db, loanId: string, period: string, userId: string) =>
  ensureCommitment(db, toPeriod(period), (c) => c.origin.kind === 'loan' && c.origin.id === loanId, userId);

/** The month's commitment of a recurring expense (its key carries the month of origin). */
const recurringCommitment = (db: Db, recurringExpenseId: string, period: string, userId: string) =>
  ensureCommitment(db, toPeriod(period), sourceKey.recurringExpense(recurringExpenseId, toPeriod(period)), userId);

/**
 * Runs a document's operation through the same use cases as the PWA (D3) and leaves the
 * document on what it created, or on the commitment whose real amount came from it.
 */
async function runOperation(db: Db, operation: DocumentOperation, raw: unknown, documentId: string, userId: string): Promise<void> {
  switch (operation) {
    case 'load_card_statement': {
      const p = operationPayloads.load_card_statement.parse(raw);
      const s = await createCardStatement(db, p.statement, userId);
      const lines: string[] = [];
      for (const t of p.transactions) lines.push((await addCardTransaction(db, s.id, t, userId)).id);
      await stamp(db, cardStatement, [s.id], documentId);
      await stamp(db, cardTransaction, lines, documentId);
      return;
    }
    case 'record_utility_bill':
    case 'record_tax':
    case 'record_condo_fee': {
      const p = operationPayloads[operation].parse(raw);
      const [re] = await db.select({ class: recurringExpense.class }).from(recurringExpense).where(eq(recurringExpense.id, p.recurringExpenseId));
      if (!re) throw new ServiceError('conflict', 'invalid_reference');
      if (!(BILL_CLASSES[operation] as readonly string[]).includes(re.class)) throw new ServiceError('conflict', 'wrong_class');
      const c = await recurringCommitment(db, p.recurringExpenseId, p.period, userId);
      await setActualAmount(db, c.id, { actualAmount: p.actualAmount, updateFollowing: p.updateFollowing }, userId);
      await stamp(db, commitment, [c.id], documentId);
      if (p.updateFollowing) {
        const [amount] = await db
          .select({ id: recurringExpenseAmount.id })
          .from(recurringExpenseAmount)
          .where(and(eq(recurringExpenseAmount.recurringExpenseId, p.recurringExpenseId), eq(recurringExpenseAmount.fromPeriod, addMonths(toPeriod(c.originPeriod), 1))));
        await stamp(db, recurringExpenseAmount, amount ? [amount.id] : [], documentId);
      }
      return;
    }
    case 'record_loan_installment': {
      const p = operationPayloads.record_loan_installment.parse(raw);
      await assertLoan(db, p.loanId);
      const c = await loanInstallment(db, p.loanId, p.period, userId);
      await setActualAmount(db, c.id, { actualAmount: p.actualAmount, updateFollowing: false }, userId);
      await stamp(db, commitment, [c.id], documentId);
      return;
    }
    case 'register_payment': {
      const p = operationPayloads.register_payment.parse(raw);
      let c: typeof commitment.$inferSelect;
      if (p.loanId) {
        await assertLoan(db, p.loanId);
        c = await loanInstallment(db, p.loanId, p.period, userId);
      } else {
        const [re] = await db.select({ id: recurringExpense.id }).from(recurringExpense).where(eq(recurringExpense.id, p.recurringExpenseId!));
        if (!re) throw new ServiceError('conflict', 'invalid_reference');
        c = await recurringCommitment(db, p.recurringExpenseId!, p.period, userId);
      }
      await payAndStamp(db, [c.id], () => addPayment(db, c.id, p.payment, userId), documentId);
      return;
    }
    case 'register_card_payment': {
      const p = operationPayloads.register_card_payment.parse(raw);
      const [card] = await db.select({ localCurrency: creditCard.localCurrency }).from(creditCard).where(eq(creditCard.id, p.creditCardId));
      if (!card) throw new ServiceError('conflict', 'invalid_reference');
      const period = toPeriod(p.payment.period);
      // the month's two card commitments (D4), stored if they were still virtual
      const ids: string[] = [];
      if (p.payment.localAmount) ids.push((await ensureCommitment(db, period, sourceKey.creditCard(p.creditCardId, period, card.localCurrency), userId)).id);
      if (p.payment.usdPartAmount) ids.push((await ensureCommitment(db, period, sourceKey.creditCard(p.creditCardId, period, 'USD'), userId)).id);
      await payAndStamp(db, ids, () => payCardStatement(db, p.creditCardId, p.payment, userId), documentId);
      return;
    }
  }
}

async function assertLoan(db: Db, id: string) {
  const [l] = await db.select({ id: loan.id }).from(loan).where(eq(loan.id, id));
  if (!l) throw new ServiceError('conflict', 'invalid_reference');
}

/**
 * Tries the operation and rolls it back: what Claude proposes must be applicable (the entity
 * exists, the month is not closed, the statement is not loaded yet), or it is refused right away
 * with the same reason the PWA would get.
 */
async function dryRun(db: Db, operation: DocumentOperation, payload: unknown, userId: string): Promise<void> {
  try {
    await db.transaction(async (trx) => {
      const tx = trx as unknown as Db;
      // a document id is needed to stamp rows; this one is rolled back with everything else
      const [doc] = await tx
        .insert(sourceDocument)
        .values({ fileName: 'dry-run', fileHash: `dry-run-${crypto.randomUUID()}`, kind: 'other', uploadedBy: userId })
        .returning({ id: sourceDocument.id });
      await runOperation(tx, operation, payload, doc!.id, userId);
      throw new DryRun();
    });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  }
}

/** What makes two proposals the same thing (D3), besides the file: the statement, bill or payment of a month. */
function naturalKey(operation: DocumentOperation, raw: unknown): string {
  switch (operation) {
    case 'load_card_statement': {
      const p = operationPayloads.load_card_statement.parse(raw);
      return `${operation}:${p.statement.creditCardId}:${periodOf(p.statement.dueDate)}`;
    }
    case 'record_utility_bill':
    case 'record_tax':
    case 'record_condo_fee': {
      const p = operationPayloads[operation].parse(raw);
      return `${operation}:${p.recurringExpenseId}:${p.period}`;
    }
    case 'record_loan_installment': {
      const p = operationPayloads.record_loan_installment.parse(raw);
      return `${operation}:${p.loanId}:${p.period}`;
    }
    case 'register_payment': {
      const p = operationPayloads.register_payment.parse(raw);
      return `${operation}:${p.loanId ?? p.recurringExpenseId}:${p.period}:${p.payment.date}:${p.payment.amountPaid}`;
    }
    case 'register_card_payment': {
      const p = operationPayloads.register_card_payment.parse(raw);
      return `${operation}:${p.creditCardId}:${p.payment.period}:${p.payment.date}`;
    }
  }
}

/** Another document waiting for review already proposes the same thing. */
async function assertNoPendingTwin(db: Db, operation: DocumentOperation, payload: unknown, exceptId?: string) {
  const key = naturalKey(operation, payload);
  const pending = await db
    .select({ id: sourceDocument.id, payload: sourceDocument.payload })
    .from(sourceDocument)
    .where(and(eq(sourceDocument.status, 'pending_review'), eq(sourceDocument.operation, operation)));
  if (pending.some((d) => d.id !== exceptId && naturalKey(operation, d.payload) === key)) throw new ServiceError('conflict', 'duplicate_document');
}

async function names(db: Db): Promise<Map<string, string>> {
  const people = await db.select({ id: person.id, name: person.name }).from(person);
  return new Map(people.map((p) => [p.id, p.name]));
}

function toApi(row: Row, people: Map<string, string>): SourceDocument {
  return {
    id: row.id,
    fileName: row.fileName,
    kind: row.kind,
    operation: row.operation as DocumentOperation | null,
    payload: row.payload,
    status: row.status,
    reason: row.reason,
    uploadedBy: { id: row.uploadedBy, name: people.get(row.uploadedBy) ?? '' },
    reviewedBy: row.reviewedBy ? { id: row.reviewedBy, name: people.get(row.reviewedBy) ?? '' } : null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function load(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(sourceDocument).where(eq(sourceDocument.id, id));
  if (!row) throw new ServiceError('not_found');
  return row;
}

export async function getDocument(db: Db, id: string): Promise<SourceDocument> {
  return toApi(await load(db, id), await names(db));
}

/** The inbox (pending review and unrecognized, D3) or the documents already reviewed. */
export async function listDocuments(db: Db, status: 'inbox' | 'confirmed' | 'discarded' = 'inbox'): Promise<SourceDocument[]> {
  const statuses = status === 'inbox' ? [...INBOX] : [status];
  const rows = await db.select().from(sourceDocument).where(inArray(sourceDocument.status, statuses)).orderBy(desc(sourceDocument.createdAt));
  const people = await names(db);
  return rows.map((r) => toApi(r, people));
}

/**
 * Stores what Claude read from a document (RF-35, D3, rule 12): nothing in the domain changes
 * until a user confirms it. Refused when the same file was already loaded (its hash), when another
 * document waiting for review proposes the same thing, or when the operation could not be applied.
 * A file discarded earlier can be proposed again.
 */
export async function proposeDocument(db: Db, input: Proposal, userId: string): Promise<SourceDocument> {
  const [existing] = await db.select().from(sourceDocument).where(eq(sourceDocument.fileHash, input.fileHash));
  if (existing && existing.status !== 'discarded') throw new ServiceError('conflict', 'duplicate_file');
  const payload = input.operation ? operationPayloads[input.operation].parse(input.payload) : null;
  if (input.operation) {
    await assertNoPendingTwin(db, input.operation, payload);
    await dryRun(db, input.operation, payload, userId);
  }
  const values = {
    fileName: input.fileName,
    fileHash: input.fileHash,
    kind: input.kind,
    operation: input.operation,
    payload,
    status: input.operation ? ('pending_review' as const) : ('unrecognized' as const),
    reason: input.reason,
    uploadedBy: userId,
    reviewedBy: null,
    reviewedAt: null,
  };
  try {
    const [row] = existing
      ? await db.update(sourceDocument).set(values).where(eq(sourceDocument.id, existing.id)).returning()
      : await db.insert(sourceDocument).values(values).returning();
    return toApi(row!, await names(db));
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_file');
    throw err;
  }
}

/** Corrects the operation or its data before confirming (D3); an unrecognized document goes to review. */
export async function correctDocument(db: Db, id: string, input: DocumentCorrection, userId: string): Promise<SourceDocument> {
  const row = await load(db, id);
  if (!(INBOX as readonly string[]).includes(row.status)) throw new ServiceError('conflict', 'not_pending');
  const payload = operationPayloads[input.operation].parse(input.payload);
  await assertNoPendingTwin(db, input.operation, payload, id);
  await dryRun(db, input.operation, payload, userId);
  await db.update(sourceDocument).set({ operation: input.operation, payload, status: 'pending_review', reason: null }).where(eq(sourceDocument.id, id));
  return getDocument(db, id);
}

/**
 * Confirms a document (D3, rule 12): runs its operation, in one transaction with marking it
 * confirmed. If the operation fails nothing is applied and the document stays in the inbox.
 */
export async function confirmDocument(db: Db, id: string, userId: string): Promise<SourceDocument> {
  await load(db, id);
  await db.transaction(async (trx) => {
    const tx = trx as unknown as Db;
    // taking it out of the inbox first: two confirmations at once run the operation once
    const [row] = await tx
      .update(sourceDocument)
      .set({ status: 'confirmed', reviewedBy: userId, reviewedAt: new Date() })
      .where(and(eq(sourceDocument.id, id), eq(sourceDocument.status, 'pending_review')))
      .returning();
    if (!row) throw new ServiceError('conflict', 'not_pending');
    await runOperation(tx, row.operation as DocumentOperation, row.payload, id, userId);
  });
  return getDocument(db, id);
}

/** Discards a document: nothing in the domain was touched, so nothing is left behind. */
export async function discardDocument(db: Db, id: string, input: z.output<typeof documentDiscard>, userId: string): Promise<SourceDocument> {
  const [row] = await db
    .update(sourceDocument)
    .set({ status: 'discarded', reason: input.reason, reviewedBy: userId, reviewedAt: new Date() })
    .where(and(eq(sourceDocument.id, id), inArray(sourceDocument.status, [...INBOX])))
    .returning();
  if (!row) {
    await load(db, id);
    throw new ServiceError('conflict', 'not_pending');
  }
  return getDocument(db, id);
}
