import { cardPaymentInput } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { payCardStatement } from '../services/card-payments.js';
import { idParam, validate } from './validate.js';

/** Paying a card statement in two currencies (RF-15). Mounted under /api/credit-cards. */
export const cardPayments = new Hono<AppEnv>().post('/:id/payments', validate('param', idParam), validate('json', cardPaymentInput), async (c) => {
  return c.json(await payCardStatement(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id), 201);
});
