import { incomeReceive, paymentCreate } from '@meta31/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { addPayment, deletePayment, getCommitmentDetail, receiveIncome, undoReceiveIncome } from '../services/payments.js';
import { idParam, validate } from './validate.js';

const paymentParam = z.object({ id: z.uuid(), paymentId: z.uuid() });

/** Commitments: what is paid so far, pay (in full or in part) and undo a payment (RF-28). */
export const commitments = new Hono<AppEnv>()
  .get('/:id', validate('param', idParam), async (c) => c.json(await getCommitmentDetail(c.var.db, c.req.valid('param').id)))
  .post('/:id/payments', validate('param', idParam), validate('json', paymentCreate), async (c) => {
    return c.json(await addPayment(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id), 201);
  })
  .delete('/:id/payments/:paymentId', validate('param', paymentParam), async (c) => {
    const { id, paymentId } = c.req.valid('param');
    return c.json(await deletePayment(c.var.db, id, paymentId, c.var.user.id));
  });

/** Incomes: mark received with the real amount (RF-08), or undo it. */
export const incomes = new Hono<AppEnv>()
  .post('/:id/receive', validate('param', idParam), validate('json', incomeReceive), async (c) => {
    return c.json(await receiveIncome(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .delete('/:id/receive', validate('param', idParam), async (c) => {
    return c.json(await undoReceiveIncome(c.var.db, c.req.valid('param').id, c.var.user.id));
  });
