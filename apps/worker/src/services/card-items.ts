import type {
  InstallmentPurchase,
  InstallmentPurchaseCreate,
  InstallmentPurchaseUpdate,
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
} from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { addMonths, currentPeriod, installmentNumberIn, toPeriod } from '@meta31/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { ServiceError } from './errors.js';
import { checkNotCardCategory, checkReferences } from './references.js';

const { cardTransaction, creditCard, installmentPurchase, subscription } = schema;

type PurchaseRow = typeof installmentPurchase.$inferSelect;
type SubscriptionRow = typeof subscription.$inferSelect;

const toPurchase = (row: PurchaseRow): InstallmentPurchase => {
  const first = toPeriod(row.firstPeriod);
  return {
    id: row.id,
    creditCardId: row.creditCardId,
    description: row.description,
    categoryId: row.categoryId,
    purchaseDate: row.purchaseDate,
    currency: row.currency,
    installmentAmount: row.installmentAmount,
    installmentsTotal: row.installmentsTotal,
    firstPeriod: row.firstPeriod,
    lastPeriod: addMonths(first, row.installmentsTotal - 1),
    currentInstallment: installmentNumberIn(first, row.installmentsTotal, currentPeriod()),
  };
};

const toSubscription = (row: SubscriptionRow): Subscription => ({
  id: row.id,
  creditCardId: row.creditCardId,
  description: row.description,
  categoryId: row.categoryId,
  currency: row.currency,
  amount: row.amount,
  validFrom: row.validFrom,
  validTo: row.validTo,
});

/**
 * The card must exist and the currency must be one of its two commitments (D4): its local
 * currency or USD. The category is an expense one, never the card payment one.
 */
async function checkCardItem(
  db: Db,
  creditCardId: string,
  input: { currency?: string | undefined; categoryId?: string | undefined },
): Promise<void> {
  const [card] = await db
    .select({ localCurrency: creditCard.localCurrency })
    .from(creditCard)
    .where(eq(creditCard.id, creditCardId));
  if (!card) throw new ServiceError('conflict', 'invalid_reference');
  if (input.currency && input.currency !== card.localCurrency && input.currency !== 'USD') {
    throw new ServiceError('conflict', 'card_currency');
  }
  await checkReferences(db, 'expense', { categoryId: input.categoryId });
  await checkNotCardCategory(db, input.categoryId);
}

/** Purchases still running first (latest first month first). */
export async function listInstallmentPurchases(db: Db, creditCardId?: string): Promise<InstallmentPurchase[]> {
  const rows = await db
    .select()
    .from(installmentPurchase)
    .where(creditCardId ? eq(installmentPurchase.creditCardId, creditCardId) : undefined)
    .orderBy(desc(installmentPurchase.firstPeriod), asc(installmentPurchase.description));
  return rows.map(toPurchase);
}

export async function createInstallmentPurchase(db: Db, input: InstallmentPurchaseCreate, userId: string): Promise<InstallmentPurchase> {
  await checkCardItem(db, input.creditCardId, input);
  const [row] = await db
    .insert(installmentPurchase)
    .values({ ...input, createdBy: userId, updatedBy: userId })
    .returning();
  return toPurchase(row!);
}

/** Statements already stored keep their totals (D1); only virtual months follow the change. */
export async function updateInstallmentPurchase(
  db: Db,
  id: string,
  input: InstallmentPurchaseUpdate,
  userId: string,
): Promise<InstallmentPurchase> {
  const [current] = await db.select().from(installmentPurchase).where(eq(installmentPurchase.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkCardItem(db, current.creditCardId, input);
  const [row] = await db
    .update(installmentPurchase)
    .set({ ...input, updatedBy: userId })
    .where(eq(installmentPurchase.id, id))
    .returning();
  return toPurchase(row!);
}

/** A purchase loaded by mistake can be deleted until a real statement lists one of its installments. */
export async function deleteInstallmentPurchase(db: Db, id: string): Promise<void> {
  const [current] = await db.select({ id: installmentPurchase.id }).from(installmentPurchase).where(eq(installmentPurchase.id, id));
  if (!current) throw new ServiceError('not_found');
  const [used] = await db
    .select({ id: cardTransaction.id })
    .from(cardTransaction)
    .where(eq(cardTransaction.installmentPurchaseId, id))
    .limit(1);
  if (used) throw new ServiceError('conflict', 'in_statement');
  await db.delete(installmentPurchase).where(eq(installmentPurchase.id, id));
}

/** Active ones first, then by description. */
export async function listSubscriptions(db: Db, creditCardId?: string): Promise<Subscription[]> {
  const rows = await db
    .select()
    .from(subscription)
    .where(creditCardId ? eq(subscription.creditCardId, creditCardId) : undefined)
    .orderBy(sql`${subscription.validTo} is null desc`, asc(subscription.description));
  return rows.map(toSubscription);
}

export async function createSubscription(db: Db, input: SubscriptionCreate, userId: string): Promise<Subscription> {
  await checkCardItem(db, input.creditCardId, input);
  const [row] = await db
    .insert(subscription)
    .values({ ...input, createdBy: userId, updatedBy: userId })
    .returning();
  return toSubscription(row!);
}

/** Edits a subscription: a new amount from the latest statement, or its cancellation (`validTo`). */
export async function updateSubscription(db: Db, id: string, input: SubscriptionUpdate, userId: string): Promise<Subscription> {
  const [current] = await db.select().from(subscription).where(eq(subscription.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkCardItem(db, current.creditCardId, input);
  const validFrom = input.validFrom ?? current.validFrom;
  const validTo = input.validTo === undefined ? current.validTo : input.validTo;
  if (validTo && validTo < validFrom) throw new ServiceError('conflict', 'valid_to_before_valid_from');
  const [row] = await db
    .update(subscription)
    .set({ ...input, updatedBy: userId })
    .where(eq(subscription.id, id))
    .returning();
  return toSubscription(row!);
}

/** A subscription loaded by mistake can be deleted until a real statement lists it; after that it is cancelled. */
export async function deleteSubscription(db: Db, id: string): Promise<void> {
  const [current] = await db.select({ id: subscription.id }).from(subscription).where(eq(subscription.id, id));
  if (!current) throw new ServiceError('not_found');
  const [used] = await db
    .select({ id: cardTransaction.id })
    .from(cardTransaction)
    .where(eq(cardTransaction.subscriptionId, id))
    .limit(1);
  if (used) throw new ServiceError('conflict', 'in_statement');
  await db.delete(subscription).where(eq(subscription.id, id));
}
