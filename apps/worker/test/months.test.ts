import type { MonthProjection, OpenMonthResult } from '@meta31/contracts';
import { schema } from '@meta31/db';
import { addMonths, currentPeriod } from '@meta31/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtures, type Fixtures } from './fixtures.js';
import { type Client, createHttpClient } from './http.js';

let f: Fixtures;
let api: Client;

beforeEach(async () => {
  f = await createFixtures();
  await f.t.db.insert(schema.exchangeRate).values({ pair: 'USD_ARS', validFrom: '2026-01-01', rate: '1450' });
  api = await createHttpClient(f.t);
});

afterEach(async () => {
  await f.t.close();
});

describe('months API (RF-30, RF-31, RF-33)', () => {
  it('projects 12 months by default from the current one, as strings, without materializing', async () => {
    const res = await api.get('/api/months/projection');
    expect(res.status).toBe(200);
    const months = (await res.json()) as MonthProjection[];
    expect(months).toHaveLength(12);
    expect(months[0]!.period).toBe(currentPeriod());
    expect(await f.t.db.select().from(schema.commitment)).toEqual([]);
  });

  it('a given month: salary in, commitments out, totals in ARS and USD and the installment load', async () => {
    const [oct] = (await (await api.get('/api/months/projection?from=2026-10-01&months=1')).json()) as MonthProjection[];
    expect(oct!.incomes.map((l) => [l.description, l.amount, l.stored])).toEqual([['Sueldo', '1500000.00', false]]);
    expect(oct!.ars!.incomes).toBe('1500000.00');
    expect(oct!.usd).not.toBeNull();
    // card installment (100.000) + loan installment over the salary
    expect(oct!.installmentLoad!.percent).toMatch(/^\d+\.\d$/);
    expect(oct!.commitments.every((l) => /^\d+\.\d{2}$/.test(l.amount))).toBe(true);
  });

  it('opens the current month once (D1) and refuses to open a future one', async () => {
    const now = currentPeriod();
    const first = (await (await api.post(`/api/months/${now}/open`, {})).json()) as OpenMonthResult;
    expect(first.status).toBe('opened');
    const again = (await (await api.post(`/api/months/${now}/open`, {})).json()) as OpenMonthResult;
    expect(again).toMatchObject({ status: 'already_open', commitments: 0, incomes: 0 });

    const [opened] = (await (await api.get(`/api/months/projection?from=${now}&months=1`)).json()) as MonthProjection[];
    expect(opened!.incomes.every((l) => l.stored)).toBe(true);

    const future = await api.post(`/api/months/${addMonths(now, 1)}/open`, {});
    expect(await future.json()).toEqual({ error: 'conflict', reason: 'future_month' });
  });

  it('validates the query and the period', async () => {
    expect((await api.get('/api/months/projection?months=40')).status).toBe(400);
    expect((await api.get('/api/months/projection?from=2026-10-15')).status).toBe(400);
    expect((await api.post('/api/months/2026-10-15/open', {})).status).toBe(400);
  });
});
