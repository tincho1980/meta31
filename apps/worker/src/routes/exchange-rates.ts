import { exchangeRateCreate, exchangeRateListQuery, exchangeRateUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createExchangeRate, listExchangeRates, updateExchangeRate } from '../services/exchange-rates.js';
import { idParam, validate } from './validate.js';

/** Exchange rates (RF-04), loaded by hand with the date they apply from. */
export const exchangeRates = new Hono<AppEnv>()
  .get('/', validate('query', exchangeRateListQuery), async (c) => {
    return c.json(await listExchangeRates(c.var.db, c.req.valid('query').pair));
  })
  .post('/', validate('json', exchangeRateCreate), async (c) => {
    return c.json(await createExchangeRate(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', exchangeRateUpdate), async (c) => {
    return c.json(await updateExchangeRate(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  });
