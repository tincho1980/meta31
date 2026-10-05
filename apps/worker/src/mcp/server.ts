import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type DocumentKind,
  type DocumentOperation,
  documentKind,
  documentProposal,
  fieldErrors,
  operationPayloads,
} from '@meta31/contracts';
import type { AppUser, Db } from '@meta31/db';
import { currentPeriod, moneyToDb, toPeriod } from '@meta31/domain';
import { z } from 'zod';
import { listInstallmentPurchases, listSubscriptions } from '../services/card-items.js';
import { listCardStatements } from '../services/card-statements.js';
import { listCategories } from '../services/categories.js';
import { listCreditCards } from '../services/credit-cards.js';
import { ServiceError } from '../services/errors.js';
import { listLoans } from '../services/loans.js';
import { listPeople } from '../services/people.js';
import { projection } from '../services/projection.js';
import { listProperties } from '../services/properties.js';
import { listRecurringExpenses } from '../services/recurring-expenses.js';
import { findDocumentByHash, listDocuments, proposeDocument } from '../services/source-documents.js';

/** What Claude should do when a proposal is refused, by the reason the use case gives. */
const HINTS: Record<string, string> = {
  duplicate_file: 'This file was already loaded (same SHA-256). Do not load it again: move it to the processed folder.',
  duplicate_document: 'Another document waiting for review already proposes the same thing (same entity and month). Tell the user; do not retry.',
  duplicate_statement: 'That card already has its statement for that month loaded. Tell the user; do not retry.',
  invalid_reference: 'An id does not exist. Look it up with the list_* tools; if the entity is not loaded in Meta31, use report_unrecognized.',
  wrong_class: 'The recurring expense is of another class: use record_utility_bill for utilities, record_tax for taxes, record_condo_fee for condo fees.',
  no_commitment: 'That entity has nothing due in that month. Check the month (the month the bill is due) with get_month.',
  month_closed: 'That month is closed in Meta31. Tell the user: it has to be reopened first.',
  card_currency: 'A statement line must be in the card local currency or USD.',
  installment_number: 'That installment purchase does not have that many installments.',
  split_part: 'That installment was partly paid and the rest moved to another month; the real amount goes on the pending part.',
  not_open: 'There is no card commitment for that month to pay.',
};

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

const refusal = (error: string, reason?: string, fields?: Record<string, string>) => ({
  ...text({ error, reason, fields, hint: reason ? HINTS[reason] : undefined }),
  isError: true,
});

/** Runs a tool, answering business refusals as tool errors Claude can act on. */
async function run(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (err) {
    if (err instanceof ServiceError) return refusal(err.code, err.reason);
    throw err;
  }
}

const file = {
  fileName: z.string().describe('Name of the document file, as found in the inbox folder.'),
  fileHash: z.string().describe('SHA-256 of the file, 64 hex characters. The same file twice is refused.'),
};

const KIND_OF: Record<DocumentOperation, DocumentKind> = {
  load_card_statement: 'card_statement',
  record_utility_bill: 'utility_bill',
  record_tax: 'tax',
  record_condo_fee: 'condo_fee',
  record_loan_installment: 'loan_notice',
  register_payment: 'payment_receipt',
  register_card_payment: 'payment_receipt',
};

const DESCRIPTIONS: Record<DocumentOperation, string> = {
  load_card_statement:
    'Propose loading a real credit card statement: its totals and, ideally, every line of its breakdown (purchases, installments "n of N" pointing to the installment purchase, subscriptions, interest, fees, taxes, payments). period = month of the due date.',
  record_utility_bill: 'Propose the real amount of a utility bill (electricity, gas, water, phone…) for the month it is due. Only for bills paid outside a card.',
  record_tax: 'Propose the real amount of a tax bill (e.g. ARBA, municipal) for the month it is due.',
  record_condo_fee: 'Propose the real amount of a condo fee (expensas) for the month it is due.',
  record_loan_installment: 'Propose the real amount of a loan installment (the total charged by the bank) for the month it is due.',
  register_payment: 'Propose a payment receipt of a bill or loan installment already expected that month (it pays it; it never creates a new expense). Give recurringExpenseId or loanId.',
  register_card_payment: 'Propose a credit card payment receipt: pays the statement of that month, local part and USD part (paid in local currency, with the applied rate).',
};

/**
 * The MCP server (RF-35, RNF-08): domain operations only, no free SQL. Reading tools let Claude
 * identify the card, expense, loan or property of a document; every loading tool only proposes a
 * document for review (D3, rule 12) through the same use case as the PWA. A new server per
 * request (stateless): `db` and `user` are the request's.
 */
export function createMcpServer(db: Db, user: AppUser): McpServer {
  const server = new McpServer(
    { name: 'meta31', version: '1.0.0' },
    {
      instructions: [
        'Meta31 is the family budget planner of Martín and Rosalía (Argentina and Uruguay). You load the documents they drop in their inbox folder: card statements, utility bills, loan notices, taxes, condo fees and payment receipts.',
        'Nothing you load changes their data: every loading tool proposes a document that a user confirms, corrects or discards in the Bandeja of the app.',
        'For each file: compute its SHA-256; check find_document; identify the entity with the list_* tools (never guess an id); call the loading tool that fits; if you cannot identify the entity (a new card, an unknown service), call report_unrecognized with the reason. Then move the file to the processed folder.',
        'Amounts are decimal strings with a dot ("52300.50"), dates "YYYY-MM-DD", months "YYYY-MM-01" (the month a bill is due). Every amount keeps its own currency: never convert.',
      ].join('\n'),
    },
  );

  // --- reading -------------------------------------------------------------------------------

  server.registerTool(
    'list_credit_cards',
    { description: 'Credit cards with their bank, holder, local currency (ARS for Argentine cards, UYU for the Uruguayan one) and the months whose statement is already loaded.', annotations: { readOnlyHint: true } },
    () =>
      run(async () => {
        const [cards, people, statements] = await Promise.all([listCreditCards(db), listPeople(db), listCardStatements(db)]);
        const name = new Map(people.map((p) => [p.id, p.name]));
        return cards.map((c) => ({
          id: c.id,
          name: c.name,
          bank: c.bank,
          country: c.country,
          holder: name.get(c.holderId) ?? null,
          localCurrency: c.localCurrency,
          closingDay: c.closingDay,
          dueDay: c.dueDay,
          active: c.active,
          statementsLoaded: statements.filter((s) => s.creditCardId === c.id).map((s) => s.period),
        }));
      }),
  );

  server.registerTool(
    'list_card_items',
    {
      description: 'Installment purchases and subscriptions of a card, to point statement lines to them (installmentPurchaseId + installmentNumber, subscriptionId).',
      inputSchema: { creditCardId: z.uuid() },
      annotations: { readOnlyHint: true },
    },
    ({ creditCardId }) =>
      run(async () => ({
        installmentPurchases: await listInstallmentPurchases(db, creditCardId),
        subscriptions: await listSubscriptions(db, creditCardId),
      })),
  );

  server.registerTool(
    'list_recurring_expenses',
    {
      description:
        'Recurring expenses paid outside a card: utilities, taxes, condo fees, recurring and budget items, with class, provider, property, currency, frequency and estimated amounts. validTo = last month it applies.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const [expenses, properties] = await Promise.all([listRecurringExpenses(db), listProperties(db)]);
        const property = new Map(properties.map((p) => [p.id, p.name]));
        return expenses.map((e) => ({
          id: e.id,
          name: e.name,
          class: e.class,
          provider: e.provider,
          property: e.propertyId ? (property.get(e.propertyId) ?? null) : null,
          currency: e.currency,
          everyMonths: e.everyMonths,
          anchorMonth: e.anchorMonth,
          dueDay: e.dueDay,
          validFrom: e.validFrom,
          validTo: e.validTo,
          currentEstimate: e.amounts.at(-1)?.amount ?? null,
        }));
      }),
  );

  server.registerTool(
    'list_loans',
    { description: 'Loans with lender, currency, number of installments, first installment month and due day.', annotations: { readOnlyHint: true } },
    () => run(() => listLoans(db)),
  );

  server.registerTool(
    'list_properties',
    { description: 'Properties (houses, apartments) the recurring expenses, taxes and condo fees can belong to.', annotations: { readOnlyHint: true } },
    () => run(() => listProperties(db)),
  );

  server.registerTool(
    'list_categories',
    { description: 'Expense categories, to classify card statement lines (categoryId, optional).', annotations: { readOnlyHint: true } },
    () => run(() => listCategories(db, 'expense')),
  );

  server.registerTool(
    'get_month',
    {
      description: 'What is due in a month: each commitment with its origin (card, recurring expense, loan…), amount, currency, status and whether it is still an estimate. Use it to match a bill or a payment.',
      inputSchema: { period: z.string().describe('Month, "YYYY-MM-01". Defaults to the current month.').optional() },
      annotations: { readOnlyHint: true },
    },
    ({ period }) =>
      run(async () => {
        const [m] = await projection(db, period ? toPeriod(period) : currentPeriod(), 1);
        return {
          period: m!.period,
          commitments: m!.commitments.map((l) => ({
            description: l.description,
            origin: l.origin,
            originId: l.originId,
            dueDate: l.date,
            currency: l.currency,
            amount: moneyToDb(l.amount),
            estimate: l.estimate,
            status: l.status ?? 'pending',
            postponed: l.postponed,
          })),
        };
      }),
  );

  server.registerTool(
    'find_document',
    {
      description: 'Whether a file was already loaded (by its SHA-256), and its review status.',
      inputSchema: { fileHash: file.fileHash },
      annotations: { readOnlyHint: true },
    },
    ({ fileHash }) => run(async () => (await findDocumentByHash(db, fileHash.trim().toLowerCase())) ?? { found: false }),
  );

  server.registerTool(
    'list_inbox',
    { description: 'Documents waiting for review in the Bandeja (pending or unrecognized).', annotations: { readOnlyHint: true } },
    () => run(() => listDocuments(db, 'inbox')),
  );

  // --- loading: every tool proposes a document for review ------------------------------------

  const propose = async (input: unknown) => {
    const parsed = documentProposal.safeParse(input);
    if (!parsed.success) return refusal('validation_error', undefined, fieldErrors(parsed.error));
    return run(() => proposeDocument(db, parsed.data, user.id));
  };

  for (const operation of Object.keys(operationPayloads) as DocumentOperation[]) {
    server.registerTool(
      operation,
      {
        description: `${DESCRIPTIONS[operation]} It goes to the Bandeja for a user to confirm; nothing changes until then.`,
        inputSchema: { ...file, payload: operationPayloads[operation] as z.ZodType },
      },
      ({ fileName, fileHash, payload }) => propose({ fileName, fileHash, kind: KIND_OF[operation], operation, payload, reason: null }),
    );
  }

  server.registerTool(
    'report_unrecognized',
    {
      description:
        'Leave a document in the Bandeja without an operation, when you cannot identify what it belongs to (a card or service not loaded, an unreadable file). Say why in reason. A user completes it.',
      inputSchema: { ...file, kind: documentKind, reason: z.string().min(1).max(500) },
    },
    ({ fileName, fileHash, kind, reason }) => propose({ fileName, fileHash, kind, operation: null, reason }),
  );

  return server;
}
