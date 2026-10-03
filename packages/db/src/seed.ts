import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { person } from './schema.js';

export type SeedEmails = { martin: string; rosalia: string };

/**
 * Initial people: Martín and Rosalía (users) and Amaia (not a user).
 * Idempotent: if the person already exists (by name) it updates email and role.
 * Emails are not in the repo: they come from environment variables.
 */
export async function seedPeople(db: Db, emails: SeedEmails): Promise<void> {
  const people = [
    { name: 'Martín', email: emails.martin.trim().toLowerCase(), isUser: true },
    { name: 'Rosalía', email: emails.rosalia.trim().toLowerCase(), isUser: true },
    { name: 'Amaia', email: null, isUser: false },
  ];
  await db.transaction(async (tx) => {
    for (const p of people) {
      const existing = await tx.select({ id: person.id }).from(person).where(eq(person.name, p.name));
      const row = existing[0];
      if (row) {
        await tx.update(person).set({ email: p.email, isUser: p.isUser }).where(eq(person.id, row.id));
      } else {
        await tx.insert(person).values(p);
      }
    }
  });
}
