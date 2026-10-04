import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { category, person } from './schema.js';

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

/**
 * Expense category used for credit card statement payments: cards have no category of
 * their own and every commitment needs one. Use cases look it up by name and kind,
 * so it must not be renamed.
 */
export const CARD_PAYMENT_CATEGORY = { name: 'Tarjetas de crédito', kind: 'expense' } as const;

/**
 * Income category that marks a source as a rent (decided 3/10): every income in it is a rent,
 * with or without a property. Looked up by name and kind, so it must not be renamed either.
 */
export const RENT_CATEGORY = { name: 'Alquileres', kind: 'income' } as const;

/** Categories the system relies on: they cannot be renamed or deactivated. */
export const SYSTEM_CATEGORIES = [CARD_PAYMENT_CATEGORY, RENT_CATEGORY] as const;

/** System categories. Idempotent: inserts only the missing ones. */
export async function seedCategories(db: Db): Promise<void> {
  await db
    .insert(category)
    .values([...SYSTEM_CATEGORIES])
    .onConflictDoNothing({ target: [category.name, category.kind] });
}

/** Id of the card payment category; throws if the seed has not been run. */
export async function cardPaymentCategoryId(db: Db): Promise<string> {
  const rows = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.name, CARD_PAYMENT_CATEGORY.name), eq(category.kind, CARD_PAYMENT_CATEGORY.kind)));
  const row = rows[0];
  if (!row) throw new Error(`Missing category '${CARD_PAYMENT_CATEGORY.name}': run the seed`);
  return row.id;
}
