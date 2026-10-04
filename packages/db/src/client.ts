import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Client } from 'pg';
import * as schema from './schema.js';

/**
 * Database type used by the use cases. Shared by node-postgres (production)
 * and PGlite (tests), so the same code runs against both.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Wraps an already connected `pg` client. The Worker creates one per request against Hyperdrive. */
export function createDb(client: Client): Db {
  return drizzle({ client, schema, casing: 'snake_case' });
}
