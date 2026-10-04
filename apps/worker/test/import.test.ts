import { readFileSync } from 'node:fs';
import { type ImportFileInput, importFile } from '@meta31/contracts';
import { findUserByEmail, schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { generateForPeriod, toPeriod } from '@meta31/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportError, importInitialLoad } from '../src/services/import.js';
import { loadRules } from '../src/services/rules.js';

const example = JSON.parse(readFileSync(new URL('../scripts/import.example.json', import.meta.url), 'utf8')) as ImportFileInput;

let t: TestDb;
let userId: string;

beforeEach(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });
  await seedCategories(t.db);
  userId = (await findUserByEmail(t.db, 'martin@example.com'))!.id;
});

afterEach(async () => {
  await t.close();
});

const parse = (input: unknown) => importFile.parse(input);

describe('initial load import (RNF-15, plan decision 3)', () => {
  it('loads the example file through the use cases and the projection runs on it', async () => {
    const summary = await importInitialLoad(t.db, parse(example), userId);
    expect(summary).toEqual({
      categories: 6,
      properties: 2,
      exchangeRates: 2,
      incomeSources: 2,
      oneOffIncomes: 1,
      recurringExpenses: 2,
      oneOffExpenses: 1,
      creditCards: 1,
      installmentPurchases: 1,
      subscriptions: 1,
      statements: 1,
      loans: 1,
    });
    // "4 de 12" in October → installment 1 in July
    const [purchase] = await t.db.select().from(schema.installmentPurchase);
    expect(purchase!.firstPeriod).toBe('2026-07-01');
    // the salary raise is part of the history; the rent uses the system category
    expect(await t.db.select().from(schema.incomeSourceAmount)).toHaveLength(3);

    const rules = await loadRules(t.db);
    const oct = generateForPeriod(rules, toPeriod('2026-10-01'));
    expect(oct.issues).toEqual([]);
    const card = oct.commitments.filter((c) => c.origin.kind === 'credit_card').map((c) => c.estimatedAmount.toFixed(2)).sort();
    expect(card).toEqual(['35.50', '612345.67']); // the real October statement, not the estimate
  });

  it('a dry run checks everything and saves nothing', async () => {
    const summary = await importInitialLoad(t.db, parse(example), userId, { dryRun: true });
    expect(summary.loans).toBe(1);
    expect(await t.db.select().from(schema.loan)).toEqual([]);
    expect(await t.db.select().from(schema.property)).toEqual([]);
  });

  it('runs only once', async () => {
    await importInitialLoad(t.db, parse(example), userId);
    await expect(importInitialLoad(t.db, parse(example), userId)).rejects.toThrow(/already has rules/);
  });

  it('an unknown reference or a broken rule says where, and nothing is saved', async () => {
    const badRef = { ...example, loans: [{ ...example.loans![0]!, holder: 'Juan' }] };
    await expect(importInitialLoad(t.db, parse(badRef), userId)).rejects.toThrow('loan "Banco de ejemplo": unknown person "Juan"');
    expect(await t.db.select().from(schema.incomeSource)).toEqual([]);

    const card = example.creditCards![0]!;
    const badRule = { ...example, creditCards: [{ ...card, subscriptions: [{ ...card.subscriptions![0]!, currency: 'UYU' }] }] };
    const err = await importInitialLoad(t.db, parse(badRule), userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as Error).message).toBe('card "Visa de ejemplo", subscription "Streaming": card_currency');
  });

  it('the format itself is validated before anything runs', () => {
    const bad = importFile.safeParse({ ...example, version: 2, incomeSources: [{ name: 'X' }] });
    expect(bad.success).toBe(false);
    const both = importFile.safeParse({
      ...example,
      creditCards: [{ ...example.creditCards![0]!, installmentPurchases: [{ ...example.creditCards![0]!.installmentPurchases![0]!, firstPeriod: '2026-07-01' }] }],
    });
    expect(both.success).toBe(false); // firstPeriod or currentInstallment, not both
  });
});
