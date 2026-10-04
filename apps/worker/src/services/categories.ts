import type { Category, CategoryCreate, CategoryUpdate } from '@meta31/contracts';
import { CARD_PAYMENT_CATEGORY, type Db, schema } from '@meta31/db';
import { asc, eq } from 'drizzle-orm';
import { isUniqueViolation, ServiceError } from './errors.js';

const { category } = schema;

type Row = typeof category.$inferSelect;

const isSystem = (row: Pick<Row, 'name' | 'kind'>) =>
  row.name === CARD_PAYMENT_CATEGORY.name && row.kind === CARD_PAYMENT_CATEGORY.kind;

const toCategory = (row: Row): Category => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  active: row.active,
  system: isSystem(row),
});

export async function listCategories(db: Db, kind?: Category['kind']): Promise<Category[]> {
  const rows = await db
    .select()
    .from(category)
    .where(kind ? eq(category.kind, kind) : undefined)
    .orderBy(asc(category.kind), asc(category.name));
  return rows.map(toCategory);
}

export async function createCategory(db: Db, input: CategoryCreate, userId: string): Promise<Category> {
  try {
    const [row] = await db
      .insert(category)
      .values({ ...input, createdBy: userId, updatedBy: userId })
      .returning();
    return toCategory(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_name');
    throw err;
  }
}

/** Rename or (de)activate. The card payment category is fixed: it is looked up by name. */
export async function updateCategory(db: Db, id: string, input: CategoryUpdate, userId: string): Promise<Category> {
  const [current] = await db.select().from(category).where(eq(category.id, id));
  if (!current) throw new ServiceError('not_found');
  if (isSystem(current)) throw new ServiceError('conflict', 'system_category');
  try {
    const [row] = await db
      .update(category)
      .set({ ...input, updatedBy: userId })
      .where(eq(category.id, id))
      .returning();
    return toCategory(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_name');
    throw err;
  }
}
