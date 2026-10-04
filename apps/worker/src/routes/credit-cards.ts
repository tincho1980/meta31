import { creditCardCreate, creditCardUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createCreditCard, listCreditCards, updateCreditCard } from '../services/credit-cards.js';
import { idParam, validate } from './validate.js';

/** Credit cards (RF-10). No delete: masters are deactivated. */
export const creditCards = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listCreditCards(c.var.db)))
  .post('/', validate('json', creditCardCreate), async (c) => {
    return c.json(await createCreditCard(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', creditCardUpdate), async (c) => {
    return c.json(await updateCreditCard(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  });
