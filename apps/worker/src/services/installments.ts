import { type Db, schema } from '@meta31/db';
import { installmentDeviation, type Money, moneyToDb, toMoney } from '@meta31/domain';
import { and, eq, inArray, ne } from 'drizzle-orm';

const { commitment } = schema;

type Row = typeof commitment.$inferSelect;

export type Deviation = { amount: string; percent: string };

/**
 * A loan installment can live in several rows: the original and, if part of it was paid and
 * the rest postponed (D5), its children (and theirs). Every place that shows the real amount
 * or the deviation of an installment reads it from here, never from a single row.
 *
 * - Theoretical installment = the original row's estimate (the split never touches it).
 * - Real installment = the sum of the parts' amounts in force, once every part is known:
 *   a paid part (the original of a split is closed by what was paid) or one with a real amount.
 * - Deviation = real − theoretical (RF-23).
 */
export type InstallmentAmounts = { theoretical: string; real: string | null; deviation: Deviation | null };

const inForce = (c: Pick<Row, 'actualAmount' | 'estimatedAmount' | 'surcharge'>): Money =>
  toMoney(c.actualAmount ?? c.estimatedAmount).plus(toMoney(c.surcharge));

const known = (c: Pick<Row, 'actualAmount' | 'status'>) => c.actualAmount !== null || c.status === 'paid';

export function installmentAmounts(parts: readonly Row[]): InstallmentAmounts | null {
  const live = parts.filter((p) => p.status !== 'cancelled');
  const root = live.find((p) => p.parentCommitmentId === null) ?? live[0];
  if (!root) return null;
  const theoretical = toMoney(root.estimatedAmount);
  // a single part: real only when a real amount was loaded (paying the estimate does not make it real)
  const isKnown = live.length === 1 ? root.actualAmount !== null : live.every(known);
  if (!isKnown) return { theoretical: moneyToDb(theoretical), real: null, deviation: null };
  const real = live.reduce((acc, p) => acc.plus(inForce(p)), toMoney('0'));
  const d = installmentDeviation(theoretical, real);
  return {
    theoretical: moneyToDb(theoretical),
    real: moneyToDb(real),
    deviation: { amount: moneyToDb(d.amount), percent: d.percent.toDecimalPlaces(1, 4).toFixed(1) },
  };
}

/** Status of a whole installment: paid when every part is; partially paid when some part has payments. */
export function installmentStatus(parts: readonly Row[]): Row['status'] {
  const live = parts.filter((p) => p.status !== 'cancelled');
  if (live.length === 0) return 'cancelled';
  if (live.every((p) => p.status === 'paid')) return 'paid';
  if (live.some((p) => p.status === 'paid' || p.status === 'partially_paid')) return 'partially_paid';
  return live[0]!.status;
}

/** All the rows of the installments of some loans, grouped by loan and installment number. */
export async function loanInstallmentParts(db: Db, loanIds: string[]): Promise<Map<string, Row[]>> {
  const groups = new Map<string, Row[]>();
  if (loanIds.length === 0) return groups;
  const rows = await db.select().from(commitment).where(and(inArray(commitment.loanId, loanIds), ne(commitment.status, 'cancelled')));
  for (const r of rows) {
    if (r.installmentNumber === null) continue;
    const key = `${r.loanId}|${r.installmentNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return groups;
}

export const installmentKey = (loanId: string, number: number) => `${loanId}|${number}`;

/** The row is the original of a split: closed by what was paid, its rest lives in a child (D5). */
export async function hasSplitChild(db: Db, id: string): Promise<boolean> {
  const [child] = await db.select({ id: commitment.id }).from(commitment).where(eq(commitment.parentCommitmentId, id)).limit(1);
  return Boolean(child);
}
