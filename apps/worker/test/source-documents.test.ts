import type { CommitmentDetail, SourceDocument } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { sourceKey, toPeriod } from '@meta31/domain';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { createFixtures, type Fixtures, OCT } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

const { cardStatement, cardTransaction, commitment, commitmentPayment, month, sourceDocument } = schema;

/**
 * Documents loaded by Claude (RF-35, D3, rule 12): nothing touches the domain until a user
 * confirms, and confirming runs the operation through the same use cases as the PWA.
 */
let f: Fixtures;
let api: Client;

const NOV = toPeriod('2026-11-01');
const hash = (n: number) => n.toString(16).padStart(64, 'a');

beforeEach(async () => {
  f = await createFixtures();
  await openMonth(f.t.db, OCT, f.userId);
  api = await createHttpClient(f.t);
});

afterEach(async () => {
  await f.t.close();
});

const powerBill = (n = 1, amount = '52300.00', period = NOV) => ({
  fileName: `luz-${n}.pdf`,
  fileHash: hash(n),
  kind: 'utility_bill',
  operation: 'record_utility_bill',
  payload: { recurringExpenseId: f.ids.power, period, actualAmount: amount },
});

async function propose(body: unknown) {
  const res = await api.post('/api/documents', body);
  return { status: res.status, body: (await res.json()) as SourceDocument & { error?: string; reason?: string; fields?: Record<string, string> } };
}

const confirm = async (id: string) => {
  const res = await api.post(`/api/documents/${id}/confirm`, {});
  return { status: res.status, body: (await res.json()) as SourceDocument & { error?: string; reason?: string } };
};

const powerCommitment = async (period = NOV) =>
  (await f.t.db.select().from(commitment).where(eq(commitment.sourceKey, sourceKey.recurringExpense(f.ids.power!, period))))[0];

describe('proposing a document (D3)', () => {
  it('goes to the inbox and touches nothing until it is confirmed', async () => {
    const { status, body } = await propose(powerBill());
    expect(status).toBe(201);
    expect(body).toMatchObject({ status: 'pending_review', operation: 'record_utility_bill', uploadedBy: { id: f.userId } });
    // November is still virtual: proposing did not materialize anything (rule 12)
    expect(await powerCommitment()).toBeUndefined();
    const inbox = (await (await api.get('/api/documents')).json()) as SourceDocument[];
    expect(inbox.map((d) => d.id)).toEqual([body.id]);
  });

  it('refuses the same file twice', async () => {
    await propose(powerBill(1));
    const again = await propose({ ...powerBill(1), fileName: 'otro-nombre.pdf' });
    expect(again).toMatchObject({ status: 409, body: { error: 'conflict', reason: 'duplicate_file' } });
  });

  it('refuses a second document proposing the same thing while the first waits for review', async () => {
    await propose(powerBill(1));
    const twin = await propose(powerBill(2, '52300.00'));
    expect(twin).toMatchObject({ status: 409, body: { reason: 'duplicate_document' } });
  });

  it('refuses an operation that could not be applied, with the reason the PWA would get', async () => {
    const unknown = await propose({ ...powerBill(), payload: { ...powerBill().payload, recurringExpenseId: crypto.randomUUID() } });
    expect(unknown).toMatchObject({ status: 409, body: { reason: 'invalid_reference' } });
    // a tax bill on a utility
    const wrong = await propose({ ...powerBill(), kind: 'tax', operation: 'record_tax' });
    expect(wrong).toMatchObject({ status: 409, body: { reason: 'wrong_class' } });
    expect(await f.t.db.select().from(sourceDocument)).toEqual([]);
  });

  it('validates the payload against its operation, and the operation against the kind', async () => {
    const bad = await propose({ ...powerBill(), payload: { recurringExpenseId: f.ids.power, period: '2026-11-15', actualAmount: '-1' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields!)).toEqual(expect.arrayContaining(['payload.period', 'payload.actualAmount']));
    const mismatch = await propose({ ...powerBill(), kind: 'card_statement' });
    expect(mismatch).toMatchObject({ status: 400, body: { fields: { operation: expect.any(String) } } });
  });

  it('an unrecognized entity stays in the inbox with the reason; once corrected it can be confirmed', async () => {
    const { body } = await propose({ fileName: 'tarjeta-nueva.pdf', fileHash: hash(9), kind: 'card_statement', operation: null, reason: 'Unknown card: Amex' });
    expect(body).toMatchObject({ status: 'unrecognized', reason: 'Unknown card: Amex' });
    const noReason = await propose({ fileName: 'x.pdf', fileHash: hash(10), kind: 'other', operation: null });
    expect(noReason).toMatchObject({ status: 400, body: { fields: { reason: 'required' } } });

    const corrected = (await (await api.put(`/api/documents/${body.id}`, { operation: 'record_utility_bill', payload: powerBill().payload })).json()) as SourceDocument;
    expect(corrected).toMatchObject({ status: 'pending_review', reason: null });
    expect((await confirm(body.id)).body.status).toBe('confirmed');
  });
});

describe('confirming a document (D3, rule 12)', () => {
  it('applies the operation and leaves the document on the commitment', async () => {
    const { body } = await propose(powerBill());
    const done = await confirm(body.id);
    expect(done.body).toMatchObject({ status: 'confirmed', reviewedBy: { id: f.userId } });
    expect(await powerCommitment()).toMatchObject({ actualAmount: '52300.00', entryMode: 'claude', sourceDocumentId: body.id });
    // out of the inbox, and it cannot be confirmed twice
    expect(await (await api.get('/api/documents')).json()).toEqual([]);
    expect(await confirm(body.id)).toMatchObject({ status: 409, body: { reason: 'not_pending' } });
  });

  it('applies nothing when the operation fails at confirmation; the document stays in the inbox', async () => {
    const { body } = await propose(powerBill(1, '52300.00', OCT));
    await f.t.db.update(month).set({ status: 'closed' }).where(eq(month.period, OCT));
    expect(await confirm(body.id)).toMatchObject({ status: 409, body: { reason: 'month_closed' } });
    expect((await powerCommitment(OCT))!.actualAmount).toBeNull();
    expect((await getDoc(body.id)).status).toBe('pending_review');
  });

  it('a card statement loads with its breakdown, all of it marked as loaded by Claude', async () => {
    const statement = {
      creditCardId: f.ids.card,
      closingDate: '2026-10-25',
      dueDate: '2026-11-08',
      previousBalanceLocal: '0',
      previousBalanceUsd: '0',
      totalLocal: '350000.00',
      totalUsd: '0',
      minimumPaymentLocal: '35000.00',
    };
    const line = { date: '2026-10-10', categoryId: null, currency: 'ARS', installmentPurchaseId: null, installmentNumber: null, subscriptionId: null };
    const transactions = [
      { ...line, kind: 'purchase', description: 'Supermercado', amount: '250000.00' },
      { ...line, kind: 'interest', description: 'Intereses', amount: '100000.00' },
    ];
    const { body } = await propose({ fileName: 'visa-nov.pdf', fileHash: hash(3), kind: 'card_statement', operation: 'load_card_statement', payload: { statement, transactions } });
    expect(await f.t.db.select().from(cardStatement)).toEqual([]);
    await confirm(body.id);
    const [s] = await f.t.db.select().from(cardStatement);
    expect(s).toMatchObject({ totalLocal: '350000.00', entryMode: 'claude', sourceDocumentId: body.id });
    const lines = await f.t.db.select().from(cardTransaction);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.sourceDocumentId === body.id && l.entryMode === 'claude')).toBe(true);
  });

  it('a statement already loaded by hand is refused, at proposal and at confirmation', async () => {
    const statement = {
      creditCardId: f.ids.card,
      closingDate: '2026-10-25',
      dueDate: '2026-11-08',
      previousBalanceLocal: '0',
      previousBalanceUsd: '0',
      totalLocal: '350000.00',
      totalUsd: '0',
      minimumPaymentLocal: '35000.00',
    };
    const doc = { fileName: 'visa-nov.pdf', fileHash: hash(3), kind: 'card_statement', operation: 'load_card_statement', payload: { statement } };
    const { body } = await propose(doc);
    // loaded by hand while the document waited for review
    expect((await api.post('/api/card-statements', statement)).status).toBe(201);
    expect(await confirm(body.id)).toMatchObject({ status: 409, body: { reason: 'duplicate_statement' } });
    expect(await f.t.db.select().from(cardStatement)).toHaveLength(1);
    // and, once that one is discarded, a new document for it is refused right away
    await api.post(`/api/documents/${body.id}/discard`, {});
    expect(await propose({ ...doc, fileHash: hash(4) })).toMatchObject({ status: 409, body: { reason: 'duplicate_statement' } });
  });

  it('a payment receipt pays the bill already there: no new commitment', async () => {
    const bill = await propose(powerBill());
    await confirm(bill.body.id);
    const receipt = await propose({
      fileName: 'pago-luz.pdf',
      fileHash: hash(5),
      kind: 'payment_receipt',
      operation: 'register_payment',
      payload: { recurringExpenseId: f.ids.power, period: NOV, payment: { date: '2026-11-18', paymentCurrency: 'ARS', amountPaid: '52300.00', paymentMethod: 'debit' } },
    });
    expect(receipt.status).toBe(201);
    await confirm(receipt.body.id);
    const rows = await f.t.db.select().from(commitment).where(eq(commitment.recurringExpenseId, f.ids.power!));
    const nov = rows.filter((r) => r.originPeriod === NOV);
    expect(nov).toHaveLength(1);
    // the commitment keeps the bill's document; the payment carries the receipt's
    expect(nov[0]).toMatchObject({ status: 'paid', sourceDocumentId: bill.body.id });
    const [payment] = await f.t.db.select().from(commitmentPayment).where(eq(commitmentPayment.commitmentId, nov[0]!.id));
    expect(payment).toMatchObject({ amountPaid: '52300.00', entryMode: 'claude', sourceDocumentId: receipt.body.id });
  });

  it('a loan notice loads the real installment of a month still virtual', async () => {
    const { body } = await propose({
      fileName: 'cuota.pdf',
      fileHash: hash(6),
      kind: 'loan_notice',
      operation: 'record_loan_installment',
      payload: { loanId: f.ids.loan, period: NOV, actualAmount: '210000.00' },
    });
    await confirm(body.id);
    const [installment] = await f.t.db
      .select()
      .from(commitment)
      .where(and(eq(commitment.loanId, f.ids.loan!), eq(commitment.originPeriod, NOV)));
    expect(installment).toMatchObject({ actualAmount: '210000.00', sourceDocumentId: body.id });
    const detail = (await (await api.get(`/api/commitments/${installment!.id}`)).json()) as CommitmentDetail;
    expect(detail.deviation).not.toBeNull();
  });

  it('a card payment receipt pays the statement of that month', async () => {
    const { body } = await propose({
      fileName: 'pago-visa.pdf',
      fileHash: hash(7),
      kind: 'payment_receipt',
      operation: 'register_card_payment',
      payload: { creditCardId: f.ids.card, payment: { period: OCT, date: '2026-10-08', paymentMethod: 'transfer', localAmount: '100000.00' } },
    });
    expect(body.status).toBe('pending_review');
    await confirm(body.id);
    const [local] = await f.t.db.select().from(commitment).where(eq(commitment.sourceKey, sourceKey.creditCard(f.ids.card!, OCT, 'ARS')));
    const [payment] = await f.t.db.select().from(commitmentPayment).where(eq(commitmentPayment.commitmentId, local!.id));
    expect(payment).toMatchObject({ amountPaid: '100000.00', sourceDocumentId: body.id });
  });
});

describe('discarding a document', () => {
  it('leaves nothing behind, and the same file can be proposed again', async () => {
    const { body } = await propose(powerBill());
    const discarded = (await (await api.post(`/api/documents/${body.id}/discard`, { reason: 'Wrong month' })).json()) as SourceDocument;
    expect(discarded).toMatchObject({ status: 'discarded', reason: 'Wrong month', reviewedBy: { id: f.userId } });
    expect(await powerCommitment()).toBeUndefined();
    expect(await confirm(body.id)).toMatchObject({ status: 409, body: { reason: 'not_pending' } });

    const again = await propose(powerBill(1, '51000.00'));
    expect(again).toMatchObject({ status: 201, body: { id: body.id, status: 'pending_review' } });
  });
});

async function getDoc(id: string) {
  return (await (await api.get(`/api/documents/${id}`)).json()) as SourceDocument;
}
