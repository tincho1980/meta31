// Local development server: the real Hono app over a persisted PGlite database, with no
// Supabase and no Google login. Never imported by src/index.ts, so it never reaches the
// deployed Worker. Usage: pnpm dev:local (pair it with the PWA in local auth mode, see docs/setup.md).
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { findUserByEmail, schema, seedCategories, seedPeople } from '@meta31/db';
import { createTestDb } from '@meta31/db/testing';
import { createMiddleware } from 'hono/factory';
import { createApp } from '../src/app.js';
import type { AppEnv, Bindings } from '../src/env.js';

const PORT = 8787;
/** The PWA in local auth mode sends this token; it maps to the seeded user below. */
const DEV_TOKEN = 'dev-local-token';
const DEV_EMAIL = 'martin@dev.local';

const dataDir = fileURLToPath(new URL('../../../.local-db', import.meta.url));
const { db } = await createTestDb(dataDir);

// Idempotent seed: people, system categories and a couple of exchange rates to play with.
await seedPeople(db, { martin: DEV_EMAIL, rosalia: 'rosalia@dev.local' });
await seedCategories(db);
await db
  .insert(schema.exchangeRate)
  .values([
    { pair: 'USD_ARS', validFrom: '2026-09-01', rate: '1420' },
    { pair: 'UYU_USD', validFrom: '2026-09-01', rate: '40.5' },
  ])
  .onConflictDoNothing();
const user = await findUserByEmail(db, DEV_EMAIL);
if (!user) throw new Error('Dev user missing after seed');

const app = createApp({
  db: createMiddleware<AppEnv>(async (c, next) => {
    c.set('db', db);
    await next();
  }),
  verifier: () => async (token) => {
    if (token !== DEV_TOKEN) throw new Error('Invalid dev token');
    return { email: DEV_EMAIL };
  },
});

const env: Bindings = {
  HYPERDRIVE: { connectionString: 'unused-locally' },
  SUPABASE_URL: 'http://localhost',
  ALLOWED_ORIGINS: 'http://localhost:5173',
};

serve({ fetch: (req) => app.fetch(req, env), port: PORT }, () => {
  console.log(`Local API on http://localhost:${PORT} (PGlite in .local-db, user ${user.name})`);
});
