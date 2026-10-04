import { type CreditCard, type CreditCardCreate, type CreditCardUpdate, localCurrencyOf } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { asc, desc, eq } from 'drizzle-orm';
import { ServiceError } from './errors.js';
import { checkReferences } from './references.js';

const { creditCard } = schema;

type Row = typeof creditCard.$inferSelect;

const toCreditCard = (row: Row): CreditCard => ({
  id: row.id,
  name: row.name,
  bank: row.bank,
  country: row.country,
  holderId: row.holderId,
  localCurrency: row.localCurrency,
  closingDay: row.closingDay,
  dueDay: row.dueDay,
  estimatedSpendLocal: row.estimatedSpendLocal,
  estimatedSpendUsd: row.estimatedSpendUsd,
  active: row.active,
});

/** Active ones first, then by name. */
export async function listCreditCards(db: Db): Promise<CreditCard[]> {
  const rows = await db.select().from(creditCard).orderBy(desc(creditCard.active), asc(creditCard.name));
  return rows.map(toCreditCard);
}

/** New card (RF-10); its local (payment) currency comes from the country (rule 3). */
export async function createCreditCard(db: Db, input: CreditCardCreate, userId: string): Promise<CreditCard> {
  await checkReferences(db, 'expense', { personIds: [input.holderId] });
  const [row] = await db
    .insert(creditCard)
    .values({ ...input, localCurrency: localCurrencyOf(input.country), createdBy: userId, updatedBy: userId })
    .returning();
  return toCreditCard(row!);
}

/**
 * Edits or (de)activates a card. Changing the country changes the payment currency; statements
 * already stored keep theirs (D1).
 */
export async function updateCreditCard(db: Db, id: string, input: CreditCardUpdate, userId: string): Promise<CreditCard> {
  await checkReferences(db, 'expense', { personIds: [input.holderId] });
  const [row] = await db
    .update(creditCard)
    .set({ ...input, ...(input.country ? { localCurrency: localCurrencyOf(input.country) } : {}), updatedBy: userId })
    .where(eq(creditCard.id, id))
    .returning();
  if (!row) throw new ServiceError('not_found');
  return toCreditCard(row);
}
