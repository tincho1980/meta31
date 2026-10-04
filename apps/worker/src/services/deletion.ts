import { type Db, schema } from '@meta31/db';
import { eq } from 'drizzle-orm';
import { ServiceError } from './errors.js';

const { commitment } = schema;

/**
 * A rule can be deleted only while everything it generates is still virtual (D1). Once a
 * commitment of it is stored (month opened, paid, postponed), that commitment is cancelled
 * from the month view instead, and the rule is ended with `validTo` or edited.
 */
export async function checkNothingStored(
  db: Db,
  origin: { recurringExpenseId: string } | { oneOffExpenseId: string } | { loanId: string },
): Promise<void> {
  const where =
    'recurringExpenseId' in origin
      ? eq(commitment.recurringExpenseId, origin.recurringExpenseId)
      : 'oneOffExpenseId' in origin
        ? eq(commitment.oneOffExpenseId, origin.oneOffExpenseId)
        : eq(commitment.loanId, origin.loanId);
  const [stored] = await db.select({ id: commitment.id }).from(commitment).where(where).limit(1);
  if (stored) throw new ServiceError('conflict', 'has_stored_commitments');
}
