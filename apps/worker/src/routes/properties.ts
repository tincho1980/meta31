import { propertyCreate, propertyUpdate } from '@meta31/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { createProperty, listProperties, updateProperty } from '../services/properties.js';
import { idParam, validate } from './validate.js';

/** Properties (RF-26). No delete: masters are deactivated. */
export const properties = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listProperties(c.var.db)))
  .post('/', validate('json', propertyCreate), async (c) => {
    return c.json(await createProperty(c.var.db, c.req.valid('json'), c.var.user.id), 201);
  })
  .patch('/:id', validate('param', idParam), validate('json', propertyUpdate), async (c) => {
    return c.json(await updateProperty(c.var.db, c.req.valid('param').id, c.req.valid('json'), c.var.user.id));
  });
