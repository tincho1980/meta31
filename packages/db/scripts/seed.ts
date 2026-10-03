// Loads the initial people. Run by Martín: pnpm --filter @meta31/db seed
// Reads DATABASE_URL, SEED_EMAIL_MARTIN and SEED_EMAIL_ROSALIA from packages/db/.env.
import pg from 'pg';
import { createDb } from '../src/client.js';
import { seedPeople } from '../src/seed.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in packages/db/.env`);
  return value;
}

const client = new pg.Client({ connectionString: required('DATABASE_URL') });
await client.connect();
try {
  await seedPeople(createDb(client), {
    martin: required('SEED_EMAIL_MARTIN'),
    rosalia: required('SEED_EMAIL_ROSALIA'),
  });
  console.log('People loaded: Martín, Rosalía, Amaia.');
} finally {
  await client.end();
}
