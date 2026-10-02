import { createDb } from '@meta31/db';
import { createMiddleware } from 'hono/factory';
import pg from 'pg';
import type { AppEnv } from '../env.js';

/**
 * Un cliente `pg` por request contra Hyperdrive (Hyperdrive hace el pooling).
 * Nunca guardar conexiones en variables globales del Worker.
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
