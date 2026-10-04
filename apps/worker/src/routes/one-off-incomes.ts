import { oneOffIncomeCreate, oneOffIncomeUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createOneOffIncome, deleteOneOffIncome, listOneOffIncomes, updateOneOffIncome } from '../services/one-off-incomes.js';
import { idParam, validate } from './validate.js';

/** One-off incomes (RF-09). Edit and delete only while they are still expected. */
export const oneOffIncomes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listOneOffIncomes(c.var.db)))
  .post('/', validate('json', oneOffIncomeCreate), async (c) => {
    return c.json(await createOneOffIncome(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', oneOffIncomeUpdate), async (c) => {
    return c.json(await updateOneOffIncome(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    await deleteOneOffIncome(c.var.db, c.req.valid('param').id);
    return c.body(null, 204);
  });
