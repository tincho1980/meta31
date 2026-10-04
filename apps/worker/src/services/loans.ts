import type { Loan, LoanCreate, LoanSchedule, LoanUpdate } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import {
  addMonths,
  amortizationSchedule,
  comparePeriods,
  currentPeriod,
  dateInPeriod,
  daysBetween,
  moneyToDb,
  type ScheduleRow,
  toPeriod,
} from '@meta31/domain';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { checkNothingStored } from './deletion.js';
import { ServiceError } from './errors.js';
import { deviationOf } from './payments.js';
import { checkNotCardCategory, checkReferences } from './references.js';
import { loanRuleOf } from './rules.js';

const { commitment, loan } = schema;

type Row = typeof loan.$inferSelect;
type StoredInstallment = typeof commitment.$inferSelect;

/** Amounts of a schedule row as strings: pesos to cents; UVAs keep 6 decimals. */
const rowToApi = (row: ScheduleRow, uva: boolean) => {
  const out = (x: ScheduleRow['total']) => (uva ? x.toDecimalPlaces(6).toFixed(6) : moneyToDb(x));
  return {
    number: row.number,
    period: row.period,
    dueDate: row.dueDate,
    days: row.days,
    openingBalance: out(row.openingBalance),
    principal: out(row.principal),
    interest: out(row.interest),
    vat: out(row.vat),
    insurance: out(row.insurance),
    total: out(row.total),
    closingBalance: out(row.closingBalance),
  };
};

/**
 * Stored installments by number (not cancelled). A split installment (D5) has the original and
 * its child; it counts as paid when all of them are.
 */
function installmentsByNumber(stored: readonly StoredInstallment[]) {
  const map = new Map<number, StoredInstallment[]>();
  for (const c of stored) {
    if (c.installmentNumber === null || c.status === 'cancelled') continue;
    map.set(c.installmentNumber, [...(map.get(c.installmentNumber) ?? []), c]);
  }
  return map;
}

/**
 * Installments taken as paid (RF-25): the ones before the first stored installment are history
 * from before the initial load; from there on, the last installment fully paid in the system.
 */
function paidInstallments(scheduleLength: number, schedule: ScheduleRow[], byNumber: Map<number, StoredInstallment[]>): number {
  const numbers = [...byNumber.keys()];
  const historical = numbers.length
    ? Math.min(...numbers) - 1
    : schedule.filter((r) => comparePeriods(r.period, currentPeriod()) < 0).length;
  const fullyPaid = numbers.filter((n) => byNumber.get(n)!.every((c) => c.status === 'paid'));
  return Math.min(scheduleLength, Math.max(historical, ...fullyPaid));
}

const toLoan = (row: Row, stored: readonly StoredInstallment[]): Loan => {
  const schedule = amortizationSchedule(loanRuleOf(row));
  const uva = row.kind === 'uva';
  const now = currentPeriod();
  const current = schedule.find((r) => r.period === now);
  const paid = paidInstallments(schedule.length, schedule, installmentsByNumber(stored));
  const balance = paid === 0 ? rowToApi(schedule[0]!, uva).openingBalance : rowToApi(schedule[paid - 1]!, uva).closingBalance;
  return {
    id: row.id,
    lender: row.lender,
    holderId: row.holderId,
    categoryId: row.categoryId,
    currency: row.currency,
    kind: row.kind,
    amortizationSystem: row.amortizationSystem,
    principal: row.principal,
    principalUva: row.principalUva,
    nominalAnnualRate: row.nominalAnnualRate,
    effectiveAnnualRate: row.effectiveAnnualRate,
    totalFinancialCost: row.totalFinancialCost,
    interestVatRate: row.interestVatRate,
    monthlyInsurance: row.monthlyInsurance,
    grantedDate: row.grantedDate,
    installmentsTotal: row.installmentsTotal,
    firstPeriod: row.firstPeriod,
    dueDay: row.dueDay,
    quotedInstallment: row.quotedInstallment,
    lastPeriod: addMonths(toPeriod(row.firstPeriod), row.installmentsTotal - 1),
    firstInstallment: rowToApi(schedule[0]!, uva).total,
    currentInstallment: current ? { number: current.number, dueDate: current.dueDate, total: rowToApi(current, uva).total } : null,
    remainingPrincipal: balance,
    paidInstallments: paid,
    remainingInstallments: schedule.length - paid,
  };
};

/** Stored installments of some loans. */
async function storedInstallments(db: Db, loanIds: string[]): Promise<StoredInstallment[]> {
  if (loanIds.length === 0) return [];
  return db
    .select()
    .from(commitment)
    .where(and(inArray(commitment.loanId, loanIds), isNotNull(commitment.installmentNumber), ne(commitment.status, 'cancelled')));
}

async function withStored(db: Db, row: Row): Promise<Loan> {
  return toLoan(row, await storedInstallments(db, [row.id]));
}

/**
 * Rules that need the whole loan: the first due date comes after the grant date (else there is
 * no first interest period), and UVA loans are in pesos (the UVA is an Argentine peso index).
 */
function checkTerms(v: Pick<Row, 'kind' | 'currency' | 'grantedDate' | 'firstPeriod' | 'dueDay'>): void {
  if (daysBetween(v.grantedDate, dateInPeriod(toPeriod(v.firstPeriod), v.dueDay)) <= 0) {
    throw new ServiceError('conflict', 'granted_after_first_due');
  }
  if (v.kind === 'uva' && v.currency !== 'ARS') throw new ServiceError('conflict', 'uva_currency');
}

async function checkRefs(db: Db, input: { holderId?: string | undefined; categoryId?: string | undefined }) {
  await checkReferences(db, 'expense', { categoryId: input.categoryId, personIds: [input.holderId] });
  await checkNotCardCategory(db, input.categoryId);
}

/** By first month. */
export async function listLoans(db: Db): Promise<Loan[]> {
  const rows = await db.select().from(loan).orderBy(asc(loan.firstPeriod), asc(loan.lender));
  const stored = await storedInstallments(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toLoan(r, stored.filter((c) => c.loanId === r.id)));
}

/** New loan (RF-22): its terms; the installments are projected from the theoretical schedule. */
export async function createLoan(db: Db, input: LoanCreate, userId: string): Promise<Loan> {
  checkTerms(input);
  await checkRefs(db, input);
  const [row] = await db
    .insert(loan)
    .values({ ...input, createdBy: userId, updatedBy: userId })
    .returning();
  return withStored(db, row!);
}

/** Edits the terms. Installments already stored keep their amounts (D1). */
export async function updateLoan(db: Db, id: string, input: LoanUpdate, userId: string): Promise<Loan> {
  const [current] = await db.select().from(loan).where(eq(loan.id, id));
  if (!current) throw new ServiceError('not_found');
  const merged = { ...current, ...input };
  if ((merged.kind === 'uva') !== (merged.principalUva !== null)) throw new ServiceError('conflict', 'uva_principal');
  checkTerms(merged);
  await checkRefs(db, input);
  const [row] = await db
    .update(loan)
    .set({ ...input, updatedBy: userId })
    .where(eq(loan.id, id))
    .returning();
  return withStored(db, row!);
}

/** Theoretical schedule (RF-23): never stored, recomputed from the terms. */
export async function getLoanSchedule(db: Db, id: string): Promise<LoanSchedule> {
  const [row] = await db.select().from(loan).where(eq(loan.id, id));
  if (!row) throw new ServiceError('not_found');
  const uva = row.kind === 'uva';
  const byNumber = installmentsByNumber(await storedInstallments(db, [id]));
  return {
    unit: uva ? 'UVA' : row.currency,
    rows: amortizationSchedule(loanRuleOf(row)).map((r) => {
      const stored = byNumber.get(r.number);
      // the original row carries the real amount; a split one is paid when all its parts are
      const original = stored?.find((c) => c.parentCommitmentId === null) ?? stored?.[0];
      return {
        ...rowToApi(r, uva),
        stored: original
          ? {
              // a split installment has no single real amount: its original only records what was paid
              actualAmount: stored!.length > 1 ? null : original.actualAmount,
              deviation: deviationOf(original, stored!.length > 1),
              status: stored!.every((c) => c.status === 'paid')
                ? ('paid' as const)
                : stored!.some((c) => c.status === 'paid' || c.status === 'partially_paid')
                  ? ('partially_paid' as const)
                  : original.status,
            }
          : null,
      };
    }),
  };
}

/** A loan loaded by mistake can be deleted while none of its installments is stored. */
export async function deleteLoan(db: Db, id: string): Promise<void> {
  const [current] = await db.select({ id: loan.id }).from(loan).where(eq(loan.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkNothingStored(db, { loanId: id });
  await db.delete(loan).where(eq(loan.id, id));
}
