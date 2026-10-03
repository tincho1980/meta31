// Base de test: Postgres real en memoria (PGlite) con las mismas migraciones que producción.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from './client.js';
import * as schema from './schema.js';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export type TestDb = { db: Db; close: () => Promise<void> };

/** Crea una base vacía en memoria y le aplica todas las migraciones. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  return { db: db as unknown as Db, close: () => client.close() };
}
