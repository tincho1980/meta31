// Test database: real in-memory Postgres (PGlite) with the same migrations as production.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from './client.js';
import * as schema from './schema.js';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export type TestDb = { db: Db; close: () => Promise<void> };

/**
 * Creates a database and applies every pending migration: in memory by default (tests),
 * or persisted in `dataDir` (local development server).
 */
export async function createTestDb(dataDir?: string): Promise<TestDb> {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  return { db: db as unknown as Db, close: () => client.close() };
}
