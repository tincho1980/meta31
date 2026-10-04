import { amountEntryCreate, amountEntryUpdate, recurringExpenseCreate, recurringExpenseUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import {
  addRecurringExpenseAmount,
  createRecurringExpense,
  listRecurringExpenses,
  updateRecurringExpense,
  updateRecurringExpenseAmount,
} from '../services/recurring-expenses.js';
import { amountParam, idParam, validate } from './validate.js';

/** Recurring expenses (RF-17, RF-18, RF-20) and their amount history (RF-19). No delete: they end with `validTo`. */
export const recurringExpenses = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listRecurringExpenses(c.var.db)))
  .post('/', validate('json', recurringExpenseCreate), async (c) => {
    return c.json(await createRecurringExpense(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', recurringExpenseUpdate), async (c) => {
    return c.json(await updateRecurringExpense(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .post('/:id/amounts', validate('param', idParam), validate('json', amountEntryCreate), async (c) => {
    const expense = await addRecurringExpenseAmount(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id);
    return c.json(expense, 201);
  })
  .patch('/:id/amounts/:amountId', validate('param', amountParam), validate('json', amountEntryUpdate), async (c) => {
    const { id, amountId } = c.req.valid('param');
    return c.json(await updateRecurringExpenseAmount(c.var.db, id, amountId, c.req.valid('json'), c.var.user.id));
  });
