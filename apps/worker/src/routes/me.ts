import { Hono } from 'hono';
import type { AppEnv } from '../env.js';

/** Authenticated user, read from `person`. */
export const me = new Hono<AppEnv>().get('/', (c) => {
  const { id, name, email } = c.var.user;
  return c.json({ id, name, email });
});
