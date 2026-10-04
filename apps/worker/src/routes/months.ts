import { type MonthProjection, projectionQuery } from '@meta31/contracts';
import {
  comparePeriods,
  currentPeriod,
  type MonthProjection as DomainMonth,
  moneyToDb,
  type Totals as DomainTotals,
  toPeriod,
} from '@meta31/domain';
import { Hono } from 'hono';
import { schema } from '@meta31/db';
import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { ServiceError } from '../services/errors.js';
import { listCancelled } from '../services/commitment-actions.js';
import { openMonth } from '../services/open-month.js';
import { projection } from '../services/projection.js';
import { validate } from './validate.js';

/** Domain result → API: money as strings with 2 decimals, the load percent with 1. */
function toApi(m: DomainMonth, paid: ReadonlyMap<string, string>): MonthProjection {
  const totals = (t: DomainTotals) => ({
    incomes: moneyToDb(t.incomes),
    commitments: moneyToDb(t.commitments),
    result: moneyToDb(t.result),
  });
  const line = (l: DomainMonth['incomes'][number]) => ({
    ...l,
    amount: moneyToDb(l.amount),
    amountArs: l.amountArs ? moneyToDb(l.amountArs) : null,
    paid: null as string | null,
  });
  const commitmentLine = (l: DomainMonth['commitments'][number]) => ({
    ...line(l),
    paid: l.id ? (paid.get(l.id) ?? '0.00') : null,
  });
  return {
    period: m.period,
    incomes: m.incomes.map(line),
    commitments: m.commitments.map(commitmentLine),
    byCurrency: {
      ARS: totals(m.byCurrency.ARS),
      USD: totals(m.byCurrency.USD),
      UYU: totals(m.byCurrency.UYU),
    },
    ars: m.ars ? totals(m.ars) : null,
    usd: m.usd ? totals(m.usd) : null,
    installmentLoad: m.installmentLoad
      ? {
          amountArs: moneyToDb(m.installmentLoad.amountArs),
          percent: m.installmentLoad.percent ? m.installmentLoad.percent.toDecimalPlaces(1).toFixed(1) : null,
        }
      : null,
    issues: m.issues,
  };
}

const periodParam = z.object({ period: z.iso.date().refine((v) => v.endsWith('-01'), { message: 'period' }) });

/** Months: the projection (RF-31) and the opening of a month (RF-27, D1). */
export const months = new Hono<AppEnv>()
  .get('/projection', validate('query', projectionQuery), async (c) => {
    const { from, months: count } = c.req.valid('query');
    const result = await projection(c.var.db, from ? toPeriod(from) : currentPeriod(), count ?? 12);
    // what is paid so far of each stored commitment in the horizon
    const ids = result.flatMap((m) => m.commitments.map((l) => l.id)).filter((id): id is string => id !== null);
    const sums = ids.length
      ? await c.var.db
          .select({ id: schema.commitmentPayment.commitmentId, paid: sql<string>`sum(${schema.commitmentPayment.allocatedAmount})::text` })
          .from(schema.commitmentPayment)
          .where(inArray(schema.commitmentPayment.commitmentId, ids))
          .groupBy(schema.commitmentPayment.commitmentId)
      : [];
    const paid = new Map(sums.map((s) => [s.id, s.paid]));
    return c.json(result.map((m) => toApi(m, paid)));
  })
  .post('/:period/open', validate('param', periodParam), async (c) => {
    const period = toPeriod(c.req.valid('param').period);
    // only the current month (or a past one left unopened) is materialized; the future stays virtual (D1)
    if (comparePeriods(period, currentPeriod()) > 0) throw new ServiceError('conflict', 'future_month');
    return c.json(await openMonth(c.var.db, period, c.var.user.id));
  })
  .get('/:period/cancelled', validate('param', periodParam), async (c) => {
    return c.json(await listCancelled(c.var.db, c.req.valid('param').period));
  });
