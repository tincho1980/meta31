import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

// DATABASE_URL is only needed for `migrate`. `generate` works against the schema.
// For Supabase use the Session pooler (port 5432), see docs/setup.md.
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
