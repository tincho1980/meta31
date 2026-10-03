import { Hono } from 'hono';
import type { AppEnv } from '../env.js';

/** Usuario autenticado, leído de `person`. */
export const me = new Hono<AppEnv>().get('/', (c) => {
  const { id, name, email } = c.var.user;
  return c.json({ id, name, email });
});
