import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Client } from 'pg';
import * as schema from './schema.js';

/**
 * Tipo de base que usan los casos de uso. Es común a node-postgres (producción)
 * y PGlite (tests), así el mismo código corre contra los dos.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Envuelve un cliente `pg` ya conectado. El Worker crea uno por request contra Hyperdrive. */
export function createDb(client: Client): Db {
  return drizzle({ client, schema, casing: 'snake_case' });
}
