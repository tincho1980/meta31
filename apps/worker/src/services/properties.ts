import type { Property, PropertyCreate, PropertyUpdate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { asc, desc, eq } from 'drizzle-orm';
import { ServiceError } from './errors.js';

const { property } = schema;

type Row = typeof property.$inferSelect;

const toProperty = (row: Row): Property => ({
  id: row.id,
  name: row.name,
  country: row.country,
  currency: row.currency,
  active: row.active,
});

/** Active ones first, then by name. */
export async function listProperties(db: Db): Promise<Property[]> {
  const rows = await db.select().from(property).orderBy(desc(property.active), asc(property.name));
  return rows.map(toProperty);
}

export async function createProperty(db: Db, input: PropertyCreate, userId: string): Promise<Property> {
  const [row] = await db
    .insert(property)
    .values({ ...input, createdBy: userId, updatedBy: userId })
    .returning();
  return toProperty(row!);
}

export async function updateProperty(db: Db, id: string, input: PropertyUpdate, userId: string): Promise<Property> {
  const [row] = await db
    .update(property)
    .set({ ...input, updatedBy: userId })
    .where(eq(property.id, id))
    .returning();
  if (!row) throw new ServiceError('not_found');
  return toProperty(row);
}
