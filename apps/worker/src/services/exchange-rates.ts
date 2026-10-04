import type { ExchangeRate, ExchangeRateCreate, ExchangeRateUpdate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { asc, desc, eq } from 'drizzle-orm';
import { isUniqueViolation, ServiceError } from './errors.js';

const { exchangeRate } = schema;

type Row = typeof exchangeRate.$inferSelect;

const toExchangeRate = (row: Row): ExchangeRate => ({
  id: row.id,
  pair: row.pair,
  validFrom: row.validFrom,
  rate: row.rate,
});

/** Newest first within each pair. */
export async function listExchangeRates(db: Db, pair?: ExchangeRate['pair']): Promise<ExchangeRate[]> {
  const rows = await db
    .select()
    .from(exchangeRate)
    .where(pair ? eq(exchangeRate.pair, pair) : undefined)
    .orderBy(asc(exchangeRate.pair), desc(exchangeRate.validFrom));
  return rows.map(toExchangeRate);
}

/**
 * Loads a rate (RF-04). It may be backdated: projections recompute from its date on, but
 * payments keep their own applied rate (rule 6), so nothing else needs to change here.
 */
export async function createExchangeRate(db: Db, input: ExchangeRateCreate, userId: string): Promise<ExchangeRate> {
  try {
    const [row] = await db
      .insert(exchangeRate)
      .values({ ...input, createdBy: userId, updatedBy: userId })
      .returning();
    return toExchangeRate(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_date');
    throw err;
  }
}

export async function updateExchangeRate(
  db: Db,
  id: string,
  input: ExchangeRateUpdate,
  userId: string,
): Promise<ExchangeRate> {
  try {
    const [row] = await db
      .update(exchangeRate)
      .set({ ...input, updatedBy: userId })
      .where(eq(exchangeRate.id, id))
      .returning();
    if (!row) throw new ServiceError('not_found');
    return toExchangeRate(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError('conflict', 'duplicate_date');
    throw err;
  }
}
