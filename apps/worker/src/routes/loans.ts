import { loanCreate, loanUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createLoan, deleteLoan, getLoanSchedule, listLoans, updateLoan } from '../services/loans.js';
import { idParam, validate } from './validate.js';

/** Loans (RF-22, RF-23). Delete only while none of their installments is stored. */
export const loans = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listLoans(c.var.db)))
  .post('/', validate('json', loanCreate), async (c) => {
    return c.json(await createLoan(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', loanUpdate), async (c) => {
    return c.json(await updateLoan(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .get('/:id/schedule', validate('param', idParam), async (c) => {
    return c.json(await getLoanSchedule(c.var.db, c.req.valid('param').id));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    await deleteLoan(c.var.db, c.req.valid('param').id);
    return c.body(null, 204);
  });
