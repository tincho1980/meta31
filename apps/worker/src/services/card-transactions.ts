import { type CardTransaction, type CardTransactionCreate, FINANCIAL_COST_KINDS, type FinancialCostRow } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { convert, type ExchangeRate, MissingRateError, moneyToDb, toMoney } from '@meta31/domain';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { ServiceError } from './errors.js';
import { assertMonthNotClosed } from './month-close.js';
import { checkReferences } from './references.js';

const { cardStatement, cardTransaction, creditCard, exchangeRate, installmentPurchase, subscription } = schema;

type Row = typeof cardTransaction.$inferSelect;

const toTransaction = (r: Row): CardTransaction => ({
  id: r.id,
  cardStatementId: r.cardStatementId,
  kind: r.kind,
  date: r.date,
  description: r.description,
  categoryId: r.categoryId,
  currency: r.currency,
  amount: r.amount,
  installmentPurchaseId: r.installmentPurchaseId,
  installmentNumber: r.installmentNumber,
  subscriptionId: r.subscriptionId,
});

async function statementOf(db: Db, statementId: string) {
  const [s] = await db
    .select({ id: cardStatement.id, period: cardStatement.period, creditCardId: cardStatement.creditCardId, localCurrency: creditCard.localCurrency })
    .from(cardStatement)
    .innerJoin(creditCard, eq(creditCard.id, cardStatement.creditCardId))
    .where(eq(cardStatement.id, statementId));
  if (!s) throw new ServiceError('not_found');
  return s;
}

/** The breakdown of a real statement, by date. */
export async function listCardTransactions(db: Db, statementId: string): Promise<CardTransaction[]> {
  await statementOf(db, statementId);
  const rows = await db.select().from(cardTransaction).where(eq(cardTransaction.cardStatementId, statementId)).orderBy(asc(cardTransaction.date), asc(cardTransaction.createdAt));
  return rows.map(toTransaction);
}

/**
 * Adds a line to a statement's breakdown (RF-12). Its currency is the card's local one or USD
 * (D4); an installment or subscription line may point to the purchase or subscription of that
 * same card. Informative: the statement's totals are what the projection uses.
 */
export async function addCardTransaction(db: Db, statementId: string, input: CardTransactionCreate, userId: string): Promise<CardTransaction> {
  const s = await statementOf(db, statementId);
  await assertMonthNotClosed(db, s.period);
  if (input.currency !== s.localCurrency && input.currency !== 'USD') throw new ServiceError('conflict', 'card_currency');
  if (input.categoryId) await checkReferences(db, 'expense', { categoryId: input.categoryId });
  if (input.installmentPurchaseId) {
    const [p] = await db
      .select({ creditCardId: installmentPurchase.creditCardId, total: installmentPurchase.installmentsTotal })
      .from(installmentPurchase)
      .where(eq(installmentPurchase.id, input.installmentPurchaseId));
    if (!p || p.creditCardId !== s.creditCardId) throw new ServiceError('conflict', 'invalid_reference');
    if (input.installmentNumber! > p.total) throw new ServiceError('conflict', 'installment_number');
  }
  if (input.subscriptionId) {
    const [sub] = await db.select({ creditCardId: subscription.creditCardId }).from(subscription).where(eq(subscription.id, input.subscriptionId));
    if (!sub || sub.creditCardId !== s.creditCardId) throw new ServiceError('conflict', 'invalid_reference');
  }
  const [row] = await db
    .insert(cardTransaction)
    .values({ ...input, cardStatementId: statementId, createdBy: userId, updatedBy: userId })
    .returning();
  return toTransaction(row!);
}

export async function deleteCardTransaction(db: Db, statementId: string, id: string): Promise<void> {
  const s = await statementOf(db, statementId);
  await assertMonthNotClosed(db, s.period);
  const deleted = await db
    .delete(cardTransaction)
    .where(and(eq(cardTransaction.id, id), eq(cardTransaction.cardStatementId, statementId)))
    .returning({ id: cardTransaction.id });
  if (deleted.length === 0) throw new ServiceError('not_found');
}

/**
 * Financial cost of the cards (rule 4, report): interest + admin fees + taxes of each real
 * statement, per card, month and currency, with the total in ARS at the rate of the due date.
 */
export async function financialCost(db: Db, from?: string, to?: string): Promise<FinancialCostRow[]> {
  const rows = await db
    .select({
      creditCardId: cardStatement.creditCardId,
      cardName: creditCard.name,
      period: cardStatement.period,
      dueDate: cardStatement.dueDate,
      kind: cardTransaction.kind,
      currency: cardTransaction.currency,
      amount: cardTransaction.amount,
    })
    .from(cardTransaction)
    .innerJoin(cardStatement, eq(cardStatement.id, cardTransaction.cardStatementId))
    .innerJoin(creditCard, eq(creditCard.id, cardStatement.creditCardId))
    .where(
      and(
        inArray(cardTransaction.kind, [...FINANCIAL_COST_KINDS]),
        from ? gte(cardStatement.period, from) : undefined,
        to ? lte(cardStatement.period, to) : undefined,
      ),
    )
    .orderBy(asc(cardStatement.period), asc(creditCard.name));
  const rates: ExchangeRate[] = (await db.select().from(exchangeRate)).map((r) => ({ pair: r.pair, validFrom: r.validFrom, rate: toMoney(r.rate) }));

  const groups = new Map<string, { row: (typeof rows)[number]; interest: ReturnType<typeof toMoney>; adminFee: ReturnType<typeof toMoney>; tax: ReturnType<typeof toMoney> }>();
  for (const r of rows) {
    const key = `${r.creditCardId}|${r.period}|${r.currency}`;
    const g = groups.get(key) ?? { row: r, interest: toMoney('0'), adminFee: toMoney('0'), tax: toMoney('0') };
    const amount = toMoney(r.amount);
    if (r.kind === 'interest') g.interest = g.interest.plus(amount);
    else if (r.kind === 'admin_fee') g.adminFee = g.adminFee.plus(amount);
    else g.tax = g.tax.plus(amount);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ row, interest, adminFee, tax }) => {
    const total = interest.plus(adminFee).plus(tax);
    let totalArs: string | null = null;
    try {
      totalArs = moneyToDb(convert(total, row.currency, 'ARS', rates, row.dueDate));
    } catch (err) {
      if (!(err instanceof MissingRateError)) throw err;
    }
    return {
      creditCardId: row.creditCardId,
      cardName: row.cardName,
      period: row.period,
      currency: row.currency,
      interest: moneyToDb(interest),
      adminFee: moneyToDb(adminFee),
      tax: moneyToDb(tax),
      total: moneyToDb(total),
      totalArs,
    };
  });
}
