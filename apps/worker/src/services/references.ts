import { type Db, schema } from '@meta31/db';
import { eq } from 'drizzle-orm';
import { ServiceError } from './errors.js';

const { category, person, property } = schema;

/**
 * Checks the references a rule points to: the category must exist and be of `kind`;
 * people and properties must exist. Undefined or null = not being set.
 */
export async function checkReferences(
  db: Db,
  kind: 'income' | 'expense',
  refs: {
    categoryId?: string | undefined;
    personIds?: (string | null | undefined)[];
    propertyId?: string | null | undefined;
  },
): Promise<void> {
  if (refs.categoryId) {
    const [c] = await db.select({ kind: category.kind }).from(category).where(eq(category.id, refs.categoryId));
    if (!c) throw new ServiceError('conflict', 'invalid_reference');
    if (c.kind !== kind) throw new ServiceError('conflict', 'category_kind');
  }
  for (const personId of refs.personIds ?? []) {
    if (!personId) continue;
    const [p] = await db.select({ id: person.id }).from(person).where(eq(person.id, personId));
    if (!p) throw new ServiceError('conflict', 'invalid_reference');
  }
  if (refs.propertyId) {
    const [p] = await db.select({ id: property.id }).from(property).where(eq(property.id, refs.propertyId));
    if (!p) throw new ServiceError('conflict', 'invalid_reference');
  }
}
