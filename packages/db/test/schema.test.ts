import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findUserByEmail } from '../src/queries.js';
import { category, month, person } from '../src/schema.js';
import { seedPeople } from '../src/seed.js';
import { createTestDb, type TestDb } from '../src/testing.js';

let t: TestDb;

/** `execute` sobre el tipo común Db no conoce la forma del resultado: la fijamos acá. */
async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await t.db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

describe('migración inicial', () => {
  it('crea las 21 tablas del modelo con RLS activado y sin políticas (RNF-09)', async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(sql`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`);
    expect(tables).toHaveLength(21);
    expect(tables.every((r) => r.relrowsecurity)).toBe(true);

    const policies = await rows(sql`select 1 from pg_policies where schemaname = 'public'`);
    expect(policies).toHaveLength(0);
  });

  it('rechaza un período que no es día 1 (D6)', async () => {
    await expect(t.db.insert(month).values({ period: '2026-10-15' })).rejects.toThrow();
    await t.db.insert(month).values({ period: '2026-10-01' });
  });

  it('category es única por nombre y tipo', async () => {
    await t.db.insert(category).values({ name: 'Sueldos', kind: 'income' });
    await t.db.insert(category).values({ name: 'Sueldos', kind: 'expense' });
    await expect(t.db.insert(category).values({ name: 'Sueldos', kind: 'income' })).rejects.toThrow();
  });
});

describe('seed de personas', () => {
  const emails = { martin: 'Martin@Example.com', rosalia: 'rosalia@example.com' };

  it('carga Martín y Rosalía como usuarios y Amaia como no usuaria, sin duplicar si se repite', async () => {
    await seedPeople(t.db, emails);
    await seedPeople(t.db, emails);
    const rows = await t.db
      .select({ name: person.name, email: person.email, isUser: person.isUser })
      .from(person)
      .orderBy(person.name);
    expect(rows).toEqual([
      { name: 'Amaia', email: null, isUser: false },
      { name: 'Martín', email: 'martin@example.com', isUser: true },
      { name: 'Rosalía', email: 'rosalia@example.com', isUser: true },
    ]);
  });

  it('encuentra usuarios de la lista blanca sin importar mayúsculas', async () => {
    const user = await findUserByEmail(t.db, 'MARTIN@example.com');
    expect(user?.name).toBe('Martín');
    expect(await findUserByEmail(t.db, 'intruso@example.com')).toBeNull();
  });

  it('no habilita a una persona que no es usuaria aunque tenga mail', async () => {
    await t.db.insert(person).values({ name: 'Otra', email: 'otra@example.com', isUser: false });
    expect(await findUserByEmail(t.db, 'otra@example.com')).toBeNull();
  });
});
