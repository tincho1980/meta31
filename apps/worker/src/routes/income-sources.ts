import { incomeSourceAmountCreate, incomeSourceAmountUpdate, incomeSourceCreate, incomeSourceUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import {
  addIncomeSourceAmount,
  createIncomeSource,
  listIncomeSources,
  updateIncomeSource,
  updateIncomeSourceAmount,
} from '../services/income-sources.js';
import { idParam, validate } from './validate.js';

const amountParam = z.object({ id: z.uuid(), amountId: z.uuid() });

/** Income sources (RF-07) and their amount history (rule 7). No delete: a source ends with `validTo`. */
export const incomeSources = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listIncomeSources(c.var.db)))
  .post('/', validate('json', incomeSourceCreate), async (c) => {
    return c.json(await createIncomeSource(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', incomeSourceUpdate), async (c) => {
    return c.json(await updateIncomeSource(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .post('/:id/amounts', validate('param', idParam), validate('json', incomeSourceAmountCreate), async (c) => {
    const source = await addIncomeSourceAmount(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id);
    return c.json(source, 201);
  })
  .patch('/:id/amounts/:amountId', validate('param', amountParam), validate('json', incomeSourceAmountUpdate), async (c) => {
    const { id, amountId } = c.req.valid('param');
    return c.json(await updateIncomeSourceAmount(c.var.db, id, amountId, c.req.valid('json'), c.var.user.id));
  });
