import { schema } from '@meta31/db';
import type { TestDb } from '@meta31/db/testing';
import { moneyToDb } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMonth } from '../src/services/open-month.js';
import { projection } from '../src/services/projection.js';
import { createFixtures, OCT } from './fixtures.js';

const { commitment, exchangeRate } = schema;

let t: TestDb;
let userId: string;
let ids: Record<string, string>;

beforeEach(async () => {
  ({ t, userId, ids } = await createFixtures());
  await t.db.insert(exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
});

afterEach(async () => {
  await t.close();
});

describe('projection use case (RF-31, RF-33)', () => {
  it('projects the horizon from the rules without materializing anything', async () => {
    const months = await projection(t.db, OCT, 12);
    expect(months).toHaveLength(12);
    const [oct] = months;
    // salary 1,500,000 − (electricity 45,000 + loan 213,955.04 + card 400,000)
    expect(moneyToDb(oct!.ars!.result)).toBe('841044.96');
    expect(oct!.commitments.every((l) => !l.stored)).toBe(true);
    expect(await t.db.select().from(commitment)).toHaveLength(0);
  });

  it('after opening the month, October comes from stored rows and November is still virtual', async () => {
    await openMonth(t.db, OCT, userId);
    const [oct, nov] = await projection(t.db, OCT, 2);
    expect(oct!.commitments.every((l) => l.stored)).toBe(true);
    expect(nov!.commitments.every((l) => !l.stored)).toBe(true);
    expect(moneyToDb(oct!.ars!.result)).toBe('841044.96'); // same numbers, now stored
  });

  it('reflects a stored change: actual amount and postponement (D5)', async () => {
    await openMonth(t.db, OCT, userId);
    await t.db.update(commitment).set({ actualAmount: '52000.00' }).where(eq(commitment.recurringExpenseId, ids.power!));
    await t.db.update(commitment).set({ period: '2026-11-01' }).where(eq(commitment.loanId, ids.loan!));
    const [oct, nov] = await projection(t.db, OCT, 2);
    expect(oct!.commitments.find((l) => l.origin === 'recurring_expense')!.amount.toFixed(2)).toBe('52000.00');
    expect(oct!.commitments.some((l) => l.origin === 'loan')).toBe(false);
    const novLoans = nov!.commitments.filter((l) => l.origin === 'loan');
    expect(novLoans.map((l) => [l.sourceKey, l.postponed, l.stored])).toEqual([
      [`ln:${ids.loan}:7`, true, true],
      [`ln:${ids.loan}:8`, false, false],
    ]);
  });

  it('computes the installment load: card installment + loan over income', async () => {
    const [oct] = await projection(t.db, OCT, 1);
    // fridge 100,000 + loan 213,955.04 = 313,955.04 over 1,500,000 → 20.93 %
    expect(moneyToDb(oct!.installmentLoad!.amountArs)).toBe('313955.04');
    expect(oct!.installmentLoad!.percent!.toDecimalPlaces(2).toFixed(2)).toBe('20.93');
  });

  it('rejects an unreasonable horizon', async () => {
    await expect(projection(t.db, OCT, 0)).rejects.toThrow(RangeError);
    await expect(projection(t.db, OCT, 37)).rejects.toThrow(RangeError);
  });
});
