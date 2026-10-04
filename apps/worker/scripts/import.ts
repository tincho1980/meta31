// Initial load (RNF-15, plan decision 3): imports a JSON load file through the same use cases
// as the API, in one transaction. Run by Martín.
//   pnpm --filter @meta31/worker run initial-load <file.json> --dry-run   check the file, change nothing
//   pnpm --filter @meta31/worker run initial-load <file.json>             load it into Supabase
//   pnpm --filter @meta31/worker run initial-load <file.json> --local     load it into the local PGlite (.local-db)
// Supabase: reads DATABASE_URL and SEED_EMAIL_MARTIN from packages/db/.env (same as the seed).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importFile } from '@meta31/contracts';
import { createDb, type Db, findUserByEmail } from '@meta31/db';
import pg from 'pg';
import { ImportError, importInitialLoad } from '../src/services/import.js';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const local = args.includes('--local');
if (!path) {
  console.error('Usage: initial-load <file.json> [--dry-run] [--local]');
  process.exit(1);
}

const parsed = importFile.safeParse(JSON.parse(readFileSync(path, 'utf8')));
if (!parsed.success) {
  console.error('The file does not match the load format:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  process.exit(1);
}

async function run(db: Db, email: string) {
  const user = await findUserByEmail(db, email);
  if (!user) throw new Error(`No user with email ${email}: run the seed first`);
  try {
    const summary = await importInitialLoad(db, parsed.data!, user.id, { dryRun });
    console.log(dryRun ? 'Dry run OK, nothing was saved. It would load:' : 'Loaded:');
    for (const [what, count] of Object.entries(summary)) if (count > 0) console.log(`  ${what}: ${count}`);
  } catch (err) {
    if (err instanceof ImportError) {
      console.error(`Import refused, nothing was saved: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

if (local) {
  const { createTestDb } = await import('@meta31/db/testing');
  const t = await createTestDb(fileURLToPath(new URL('../../../.local-db', import.meta.url)));
  try {
    await run(t.db, 'martin@dev.local');
  } finally {
    await t.close();
  }
} else {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../packages/db/.env', import.meta.url)));
  } catch {
    // variables may come from the environment instead
  }
  const url = process.env.DATABASE_URL?.trim();
  const email = process.env.SEED_EMAIL_MARTIN?.trim();
  if (!url || !email) throw new Error('Missing DATABASE_URL or SEED_EMAIL_MARTIN in packages/db/.env');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await run(createDb(client), email.toLowerCase());
  } finally {
    await client.end();
  }
}
