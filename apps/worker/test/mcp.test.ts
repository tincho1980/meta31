import type { SourceDocument } from '@meta31/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { schema } from '@meta31/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { createFixtures, type Fixtures, OCT } from './fixtures.js';
import { type Client as HttpClient, createHttpClient } from './http.js';

/**
 * The MCP server (RF-35, RNF-08): reading tools to identify entities, and loading tools that only
 * propose documents for review (D3, rule 12).
 */
let f: Fixtures;
let http: HttpClient;
let mcp: Client;

beforeEach(async () => {
  f = await createFixtures();
  await openMonth(f.t.db, OCT, f.userId);
  http = await createHttpClient(f.t);
  mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: http.fetch }));
});

afterEach(async () => {
  await mcp.close();
  await f.t.close();
});

const hash = (n: number) => n.toString(16).padStart(64, 'c');

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await mcp.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { isError: r.isError === true, data: JSON.parse(content[0]!.text) as Record<string, unknown> & unknown[] };
}

describe('MCP server', () => {
  it('applies the same auth as the API: an email outside the list gets 403', async () => {
    const stranger = await createHttpClient(f.t, 'stranger@example.com');
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } };
    const res = await stranger.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(init),
    });
    expect(res.status).toBe(403);
  });

  it('lists domain tools only: reading and proposing, no free SQL', async () => {
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'find_document',
        'get_month',
        'list_card_items',
        'list_categories',
        'list_credit_cards',
        'list_inbox',
        'list_loans',
        'list_properties',
        'list_recurring_expenses',
        'load_card_statement',
        'record_condo_fee',
        'record_loan_installment',
        'record_tax',
        'record_utility_bill',
        'register_card_payment',
        'register_payment',
        'report_unrecognized',
      ].sort(),
    );
    const bill = tools.find((t) => t.name === 'record_utility_bill')!;
    expect(Object.keys(bill.inputSchema.properties ?? {})).toEqual(['fileName', 'fileHash', 'payload']);
  });

  it('reading tools identify the entities of a document', async () => {
    const cards = (await call('list_credit_cards')).data as unknown as { id: string; name: string; localCurrency: string }[];
    expect(cards).toEqual([expect.objectContaining({ id: f.ids.card, name: 'Visa', localCurrency: 'ARS' })]);
    const expenses = (await call('list_recurring_expenses')).data as unknown as { name: string; class: string; currentEstimate: string }[];
    expect(expenses).toContainEqual(expect.objectContaining({ name: 'Luz', class: 'utility', currentEstimate: '45000.00' }));
    const month = (await call('get_month', { period: '2026-10-01' })).data as unknown as { commitments: { origin: string }[] };
    expect(month.commitments.map((c) => c.origin)).toEqual(expect.arrayContaining(['recurring_expense', 'loan', 'credit_card']));
  });

  it('a loading tool proposes a document and touches nothing else (rule 12)', async () => {
    const r = await call('record_utility_bill', {
      fileName: 'luz-nov.pdf',
      fileHash: hash(1),
      payload: { recurringExpenseId: f.ids.power, period: '2026-11-01', actualAmount: '52300.00' },
    });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ status: 'pending_review', operation: 'record_utility_bill', kind: 'utility_bill', uploadedBy: { id: f.userId } });
    const stored = await f.t.db.select().from(schema.commitment).where(eq(schema.commitment.recurringExpenseId, f.ids.power!));
    expect(stored.every((c) => c.originPeriod !== '2026-11-01')).toBe(true);

    expect((await call('find_document', { fileHash: hash(1) })).data).toMatchObject({ fileName: 'luz-nov.pdf', status: 'pending_review' });
    expect((await call('list_inbox')).data).toHaveLength(1);
  });

  it('refusals come back as tool errors with a hint', async () => {
    const args = { fileName: 'luz.pdf', fileHash: hash(2), payload: { recurringExpenseId: f.ids.power, period: '2026-11-01', actualAmount: '52300.00' } };
    await call('record_utility_bill', args);
    const again = await call('record_utility_bill', args);
    expect(again.isError).toBe(true);
    expect(again.data).toMatchObject({ error: 'conflict', reason: 'duplicate_file', hint: expect.stringContaining('processed folder') });

    const unknown = await call('record_loan_installment', { fileName: 'x.pdf', fileHash: hash(3), payload: { loanId: crypto.randomUUID(), period: '2026-11-01', actualAmount: '1.00' } });
    expect(unknown.data).toMatchObject({ reason: 'invalid_reference' });
  });

  it('an unrecognized document goes to the inbox with its reason, for a user to complete', async () => {
    const r = await call('report_unrecognized', { fileName: 'amex.pdf', fileHash: hash(4), kind: 'card_statement', reason: 'Unknown card: American Express 1004' });
    expect(r.data).toMatchObject({ status: 'unrecognized', reason: 'Unknown card: American Express 1004' });
    const inbox = (await (await http.get('/api/documents')).json()) as SourceDocument[];
    expect(inbox.map((d) => d.fileName)).toEqual(['amex.pdf']);
  });
});

describe('MCP authorization discovery (Supabase as OAuth 2.1 server)', () => {
  it('publishes the protected resource metadata pointing to Supabase Auth', async () => {
    const { createApp } = await import('../src/app.js');
    const { testEnv } = await import('./http.js');
    const app = createApp({ db: async (_c, next) => next(), verifier: () => async () => ({}) });
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await app.request(`https://api.example.com${path}`, {}, testEnv);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: 'https://api.example.com/mcp',
        authorization_servers: ['https://test-project.supabase.co/auth/v1'],
        bearer_methods_supported: ['header'],
        resource_name: 'Meta31',
      });
    }
  });

  it('answers 401 without a token, with the challenge that leads to the metadata', async () => {
    const { createApp } = await import('../src/app.js');
    const { testEnv } = await import('./http.js');
    const app = createApp({ db: async (_c, next) => next(), verifier: () => async () => ({}) });
    const res = await app.request('https://api.example.com/mcp', { method: 'POST', body: '{}' }, testEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"');
    // the API keeps its plain 401
    const api = await app.request('https://api.example.com/api/me', {}, testEnv);
    expect(api.status).toBe(401);
    expect(api.headers.get('WWW-Authenticate')).toBeNull();
  });
});
