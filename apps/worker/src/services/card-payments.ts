import type { CardPaymentInput, CommitmentDetail } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { sourceKey, toPeriod } from '@meta31/domain';
import { eq } from 'drizzle-orm';
import { ServiceError } from './errors.js';
import { addPayment, getCommitmentDetail } from './payments.js';

const { commitment, creditCard } = schema;

/**
 * Pays a card statement in its payment currency (RF-15, rule 3): the local part and the USD part
 * (converted with the applied rate), as two payments of the month's two card commitments (D4),
 * in one transaction. Whatever is left can be carried to the next statement (rule 4) by
 * postponing the rest.
 */
export async function payCardStatement(db: Db, cardId: string, input: CardPaymentInput, userId: string): Promise<CommitmentDetail[]> {
  const [card] = await db.select({ localCurrency: creditCard.localCurrency }).from(creditCard).where(eq(creditCard.id, cardId));
  if (!card) throw new ServiceError('not_found');
  const period = toPeriod(input.period);
  const commitmentFor = async (currency: 'ARS' | 'USD' | 'UYU') => {
    const [c] = await db.select().from(commitment).where(eq(commitment.sourceKey, sourceKey.creditCard(cardId, period, currency)));
    return c;
  };
  const local = input.localAmount ? await commitmentFor(card.localCurrency) : undefined;
  const usd = input.usdPartAmount ? await commitmentFor('USD') : undefined;
  if ((input.localAmount && !local) || (input.usdPartAmount && !usd)) throw new ServiceError('conflict', 'not_open');

  const ids = await db.transaction(async (trx) => {
    const tx = trx as unknown as Db;
    const paid: string[] = [];
    const common = { date: input.date, paymentCurrency: card.localCurrency, paymentMethod: input.paymentMethod };
    if (local && input.localAmount) {
      await addPayment(tx, local.id, { ...common, amountPaid: input.localAmount }, userId);
      paid.push(local.id);
    }
    if (usd && input.usdPartAmount) {
      await addPayment(tx, usd.id, { ...common, amountPaid: input.usdPartAmount, appliedRate: input.appliedRate ?? null }, userId);
      paid.push(usd.id);
    }
    return paid;
  });
  return Promise.all(ids.map((id) => getCommitmentDetail(db, id)));
}
