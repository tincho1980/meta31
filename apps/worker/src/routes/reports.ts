import { financialCostQuery } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { financialCost } from '../services/card-transactions.js';
import { validate } from './validate.js';

/** Reports (requisitos-funcionales, "Reportes"). */
export const reports = new Hono<AppEnv>().get('/financial-cost', validate('query', financialCostQuery), async (c) => {
  const { from, to } = c.req.valid('query');
  return c.json(await financialCost(c.var.db, from, to));
});
