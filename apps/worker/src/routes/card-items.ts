import {
  cardItemListQuery,
  installmentPurchaseCreate,
  installmentPurchaseUpdate,
  subscriptionCreate,
  subscriptionUpdate,
} from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import {
  createInstallmentPurchase,
  createSubscription,
  deleteInstallmentPurchase,
  deleteSubscription,
  listInstallmentPurchases,
  listSubscriptions,
  updateInstallmentPurchase,
  updateSubscription,
} from '../services/card-items.js';
import { idParam, validate } from './validate.js';

/** Installment purchases on cards (RF-13). Delete only until a real statement lists them. */
export const installmentPurchases = new Hono<AppEnv>()
  .get('/', validate('query', cardItemListQuery), async (c) => {
    return c.json(await listInstallmentPurchases(c.var.db, c.req.valid('query').creditCardId));
  })
  .post('/', validate('json', installmentPurchaseCreate), async (c) => {
    return c.json(await createInstallmentPurchase(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', installmentPurchaseUpdate), async (c) => {
    return c.json(await updateInstallmentPurchase(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    await deleteInstallmentPurchase(c.var.db, c.req.valid('param').id);
    return c.body(null, 204);
  });

/** Subscriptions and automatic debits on cards (RF-14). They end with `validTo`. */
export const subscriptions = new Hono<AppEnv>()
  .get('/', validate('query', cardItemListQuery), async (c) => {
    return c.json(await listSubscriptions(c.var.db, c.req.valid('query').creditCardId));
  })
  .post('/', validate('json', subscriptionCreate), async (c) => {
    return c.json(await createSubscription(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', subscriptionUpdate), async (c) => {
    return c.json(await updateSubscription(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  })
  .delete('/:id', validate('param', idParam), async (c) => {
    await deleteSubscription(c.var.db, c.req.valid('param').id);
    return c.body(null, 204);
  });
