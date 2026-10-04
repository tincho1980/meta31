import { actualAmountInput, cancelInput, incomeReceive, paymentCreate, postponeInput } from '@meta31/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import {
  cancelCommitment,
  cancelIncome,
  clearActualAmount,
  postponeCommitment,
  restoreCommitment,
  restoreIncome,
  setActualAmount,
} from '../services/commitment-actions.js';
import { addPayment, deletePayment, getCommitmentDetail, receiveIncome, undoReceiveIncome } from '../services/payments.js';
import { idParam, validate } from './validate.js';

const paymentParam = z.object({ id: z.uuid(), paymentId: z.uuid() });

/** Commitments (RF-28): pay (in full or in part), undo a payment, postpone (D5), cancel and restore. */
export const commitments = new Hono<AppEnv>()
  .get('/:id', validate('param', idParam), async (c) => c.json(await getCommitmentDetail(c.var.db, c.req.valid('param').id)))
  .post('/:id/payments', validate('param', idParam), validate('json', paymentCreate), async (c) => {
    return c.json(await addPayment(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id), 201);
  })
  .delete('/:id/payments/:paymentId', validate('param', paymentParam), async (c) => {
    const { id, paymentId } = c.req.valid('param');
    return c.json(await deletePayment(c.var.db, id, paymentId, c.var.user.id));
  })
  .post('/:id/postpone', validate('param', idParam), validate('json', postponeInput), async (c) => {
    return c.json(await postponeCommitment(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .post('/:id/cancel', validate('param', idParam), validate('json', cancelInput), async (c) => {
    return c.json(await cancelCommitment(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .post('/:id/restore', validate('param', idParam), async (c) => {
    return c.json(await restoreCommitment(c.var.db, c.req.valid('param').id, c.var.user.id));
  })
  .put('/:id/actual', validate('param', idParam), validate('json', actualAmountInput), async (c) => {
    return c.json(await setActualAmount(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .delete('/:id/actual', validate('param', idParam), async (c) => {
    return c.json(await clearActualAmount(c.var.db, c.req.valid('param').id, c.var.user.id));
  });

/** Incomes: mark received with the real amount (RF-08) or undo it; cancel and restore. */
export const incomes = new Hono<AppEnv>()
  .post('/:id/receive', validate('param', idParam), validate('json', incomeReceive), async (c) => {
    return c.json(await receiveIncome(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .delete('/:id/receive', validate('param', idParam), async (c) => {
    return c.json(await undoReceiveIncome(c.var.db, c.req.valid('param').id, c.var.user.id));
  })
  .post('/:id/cancel', validate('param', idParam), async (c) => {
    return c.json(await cancelIncome(c.var.db, c.req.valid('param').id, c.var.user.id));
  })
  .post('/:id/restore', validate('param', idParam), async (c) => {
    return c.json(await restoreIncome(c.var.db, c.req.valid('param').id, c.var.user.id));
  });
