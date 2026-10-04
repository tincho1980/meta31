import { cardItemListQuery, cardStatementCreate, cardStatementUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createCardStatement, listCardStatements, updateCardStatement } from '../services/card-statements.js';
import { idParam, validate } from './validate.js';

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
  });
