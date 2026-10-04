import { oneOffExpenseCreate, oneOffExpenseUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createOneOffExpense, listOneOffExpenses, updateOneOffExpense } from '../services/one-off-expenses.js';
import { idParam, validate } from './validate.js';

/** One-off expenses outside the card (RF-21). */
export const oneOffExpenses = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listOneOffExpenses(c.var.db)))
  .post('/', validate('json', oneOffExpenseCreate), async (c) => {
    return c.json(await createOneOffExpense(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', oneOffExpenseUpdate), async (c) => {
    return c.json(await updateOneOffExpense(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  });
