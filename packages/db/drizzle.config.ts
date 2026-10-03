import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

// DATABASE_URL solo se necesita para `migrate`. `generate` trabaja contra el schema.
// Contra Supabase usar el Session pooler (puerto 5432), ver docs/setup.md.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'drizzle',
  },
  strict: true,
  verbose: true,
});
