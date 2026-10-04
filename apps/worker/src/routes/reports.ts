import { financialCostQuery, spendingQuery } from '@meta31/contracts';
import { currentPeriod, toPeriod } from '@meta31/domain';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { financialCost } from '../services/card-transactions.js';
import { futureCommitments, loansReport, spendingByCategory } from '../services/reports.js';
import { validate } from './validate.js';

/** Reports (requisitos-funcionales, "Reportes"). */
export const reports = new Hono<AppEnv>()
  .get('/financial-cost', validate('query', financialCostQuery), async (c) => {
    const { from, to } = c.req.valid('query');
    return c.json(await financialCost(c.var.db, from, to));
  })
  .get('/loans', async (c) => c.json(await loansReport(c.var.db)))
  .get('/spending-by-category', validate('query', spendingQuery), async (c) => {
    const { period } = c.req.valid('query');
    return c.json(await spendingByCategory(c.var.db, period ? toPeriod(period) : currentPeriod()));
  })
  .get('/future-commitments', async (c) => c.json(await futureCommitments(c.var.db)));
