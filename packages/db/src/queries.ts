import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { person } from './schema.js';

export type AppUser = { id: string; name: string; email: string };

/** Looks up an enabled user (allowlist, RNF-07). Email comparison is case-insensitive. */
export async function findUserByEmail(db: Db, email: string): Promise<AppUser | null> {
  const rows = await db
    .select({ id: person.id, name: person.name, email: person.email })
    .from(person)
    .where(and(eq(person.isUser, true), eq(sql`lower(${person.email})`, email.toLowerCase())))
    .limit(1);
  const row = rows[0];
  if (!row || row.email === null) return null;
  return { id: row.id, name: row.name, email: row.email };
}
