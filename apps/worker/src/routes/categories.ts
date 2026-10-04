import { categoryCreate, categoryListQuery, categoryUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createCategory, listCategories, updateCategory } from '../services/categories.js';
import { idParam, validate } from './validate.js';

/** Categories (RF-06). No delete: masters are deactivated. */
export const categories = new Hono<AppEnv>()
  .get('/', validate('query', categoryListQuery), async (c) => {
    return c.json(await listCategories(c.var.db, c.req.valid('query').kind));
  })
  .post('/', validate('json', categoryCreate), async (c) => {
    return c.json(await createCategory(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', categoryUpdate), async (c) => {
    return c.json(await updateCategory(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  });
