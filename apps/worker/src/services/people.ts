import type { Person } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { asc, desc } from 'drizzle-orm';

const { person } = schema;

/** Users first, then by name. */
export async function listPeople(db: Db): Promise<Person[]> {
  const rows = await db
    .select({ id: person.id, name: person.name, isUser: person.isUser })
    .from(person)
    .orderBy(desc(person.isUser), asc(person.name));
  return rows;
}
