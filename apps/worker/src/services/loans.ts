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
import { asc, eq } from 'drizzle-orm';
import { checkNothingStored } from './deletion.js';
import { ServiceError } from './errors.js';
import { checkNotCardCategory, checkReferences } from './references.js';
import { loanRuleOf } from './rules.js';

const { loan } = schema;

type Row = typeof loan.$inferSelect;

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

const toLoan = (row: Row): Loan => {
  const schedule = amortizationSchedule(loanRuleOf(row));
  const uva = row.kind === 'uva';
  const now = currentPeriod();
  const current = schedule.find((r) => r.period === now);
  // first installment not yet due this month or later: its opening balance is what is still owed
  const pending = schedule.find((r) => comparePeriods(r.period, now) >= 0);
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
    remainingPrincipal: pending ? rowToApi(pending, uva).openingBalance : uva ? '0.000000' : '0.00',
  };
};

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
  return rows.map(toLoan);
}

/** New loan (RF-22): its terms; the installments are projected from the theoretical schedule. */
export async function createLoan(db: Db, input: LoanCreate, userId: string): Promise<Loan> {
  checkTerms(input);
  await checkRefs(db, input);
  const [row] = await db
    .insert(loan)
    .values({ ...input, createdBy: userId, updatedBy: userId })
    .returning();
  return toLoan(row!);
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
  return toLoan(row!);
}

/** Theoretical schedule (RF-23): never stored, recomputed from the terms. */
export async function getLoanSchedule(db: Db, id: string): Promise<LoanSchedule> {
  const [row] = await db.select().from(loan).where(eq(loan.id, id));
  if (!row) throw new ServiceError('not_found');
  const uva = row.kind === 'uva';
  return {
    unit: uva ? 'UVA' : row.currency,
    rows: amortizationSchedule(loanRuleOf(row)).map((r) => rowToApi(r, uva)),
  };
}

/** A loan loaded by mistake can be deleted while none of its installments is stored. */
export async function deleteLoan(db: Db, id: string): Promise<void> {
  const [current] = await db.select({ id: loan.id }).from(loan).where(eq(loan.id, id));
  if (!current) throw new ServiceError('not_found');
  await checkNothingStored(db, { loanId: id });
  await db.delete(loan).where(eq(loan.id, id));
}
