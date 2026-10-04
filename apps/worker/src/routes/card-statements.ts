import { cardItemListQuery, cardStatementCreate, cardStatementUpdate, cardTransactionCreate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createCardStatement, listCardStatements, updateCardStatement } from '../services/card-statements.js';
import { addCardTransaction, deleteCardTransaction, listCardTransactions } from '../services/card-transactions.js';
import { z } from 'zod';
import { idParam, validate } from './validate.js';

const transactionParam = z.object({ id: z.uuid(), transactionId: z.uuid() });

/** Real card statements with their totals (RF-11). */
export const cardStatements = new Hono<AppEnv>()
  .get('/', validate('query', cardItemListQuery), async (c) => {
    return c.json(await listCardStatements(c.var.db, c.req.valid('query').creditCardId));
  })
  .post('/', validate('json', cardStatementCreate), async (c) => {
    return c.json(await createCardStatement(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', cardStatementUpdate), async (c) => {
    return c.json(await updateCardStatement(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  // breakdown of a real statement (RF-12)
  .get('/:id/transactions', validate('param', idParam), async (c) => c.json(await listCardTransactions(c.var.db, c.req.valid('param').id)))
  .post('/:id/transactions', validate('param', idParam), validate('json', cardTransactionCreate), async (c) => {
    return c.json(await addCardTransaction(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id), 201);
  })
  .delete('/:id/transactions/:transactionId', validate('param', transactionParam), async (c) => {
    const { id, transactionId } = c.req.valid('param');
    await deleteCardTransaction(c.var.db, id, transactionId);
    return c.body(null, 204);
  });
