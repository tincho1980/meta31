import { createDb } from '@meta31/db';
import { createMiddleware } from 'hono/factory';
import pg from 'pg';
import type { AppEnv } from '../env.js';

/**
 * One `pg` client per request against Hyperdrive (Hyperdrive does the pooling).
 * Never keep connections in Worker global variables.
 */
export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  const client = new pg.Client({ connectionString: c.env.HYPERDRIVE.connectionString });
  await client.connect();
  c.set('db', createDb(client));
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});
