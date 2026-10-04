import type { ImportFile } from '@meta31/contracts';
import { type Db, schema } from '@meta31/db';
import { addMonths, toPeriod } from '@meta31/domain';
import { and, eq } from 'drizzle-orm';
import { createInstallmentPurchase, createSubscription } from './card-items.js';
import { createCardStatement } from './card-statements.js';
import { createCreditCard } from './credit-cards.js';
import { createExchangeRate } from './exchange-rates.js';
import { addIncomeSourceAmount, createIncomeSource } from './income-sources.js';
import { createLoan } from './loans.js';
import { createOneOffExpense } from './one-off-expenses.js';
import { createOneOffIncome } from './one-off-incomes.js';
import { ServiceError } from './errors.js';
import { createProperty } from './properties.js';
import { addRecurringExpenseAmount, createRecurringExpense } from './recurring-expenses.js';

const { category, creditCard, incomeSource, loan, oneOffExpense, person, recurringExpense } = schema;

/** A reference by name that does not exist, with where it was used. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export type ImportSummary = Record<
  | 'categories'
  | 'properties'
  | 'exchangeRates'
  | 'incomeSources'
  | 'oneOffIncomes'
  | 'recurringExpenses'
  | 'oneOffExpenses'
  | 'creditCards'
  | 'installmentPurchases'
  | 'subscriptions'
  | 'statements'
  | 'loans',
  number
>;

/** Thrown at the end of a dry run to roll the transaction back. */
class DryRun extends Error {
  constructor(readonly summary: ImportSummary) {
    super('dry run');
  }
}

/** The initial load is for an empty system: refuse if any rule is already loaded. */
async function checkEmpty(db: Db): Promise<void> {
  for (const table of [incomeSource, recurringExpense, oneOffExpense, creditCard, loan]) {
    const [row] = await db.select({ id: table.id }).from(table).limit(1);
    if (row) throw new ImportError('The database already has rules loaded: the initial load runs only once.');
  }
}

/**
 * Loads an initial load file (RNF-15, plan decision 3) through the same use cases as the API, so
 * the same rules apply, in a single transaction: either everything is loaded or nothing is.
 * With `dryRun` it does all of it and rolls back, to check the file first.
 */
export async function importInitialLoad(db: Db, file: ImportFile, userId: string, { dryRun = false } = {}): Promise<ImportSummary> {
  // item being loaded, to say where a business rule failed
  let current = 'the file';
  try {
    return await db.transaction(async (trx) => {
      const tx = trx as unknown as Db;
      await checkEmpty(tx);
      const summary: ImportSummary = {
        categories: 0,
        properties: 0,
        exchangeRates: 0,
        incomeSources: 0,
        oneOffIncomes: 0,
        recurringExpenses: 0,
        oneOffExpenses: 0,
        creditCards: 0,
        installmentPurchases: 0,
        subscriptions: 0,
        statements: 0,
        loans: 0,
      };

      for (const c of file.categories) {
        const inserted = await tx
          .insert(category)
          .values({ ...c, createdBy: userId, updatedBy: userId })
          .onConflictDoNothing({ target: [category.name, category.kind] })
          .returning({ id: category.id });
        summary.categories += inserted.length;
      }
      const categoryId = async (name: string, kind: 'income' | 'expense', where: string) => {
        const [row] = await tx.select({ id: category.id }).from(category).where(and(eq(category.name, name), eq(category.kind, kind)));
        if (!row) throw new ImportError(`${where}: unknown ${kind} category "${name}"`);
        return row.id;
      };
      const personId = async (name: string, where: string) => {
        const [row] = await tx.select({ id: person.id }).from(person).where(eq(person.name, name));
        if (!row) throw new ImportError(`${where}: unknown person "${name}"`);
        return row.id;
      };

      const properties = new Map<string, string>();
      for (const p of file.properties) {
        properties.set(p.name, (await createProperty(tx, p, userId)).id);
        summary.properties++;
      }
      const propertyId = (name: string | null, where: string) => {
        if (name === null) return null;
        const id = properties.get(name);
        if (!id) throw new ImportError(`${where}: unknown property "${name}"`);
        return id;
      };

      for (const r of file.exchangeRates) {
        await createExchangeRate(tx, r, userId);
        summary.exchangeRates++;
      }

      for (const s of file.incomeSources) {
        const where = `income source "${s.name}"`;
        current = where;
        const [first, ...rest] = s.amounts;
        if (first!.fromPeriod !== s.validFrom) throw new ImportError(`${where}: the first amount must start in validFrom`);
        const created = await createIncomeSource(
          tx,
          {
            name: s.name,
            categoryId: await categoryId(s.category, 'income', where),
            holderId: s.holder === null ? null : await personId(s.holder, where),
            propertyId: propertyId(s.property, where),
            currency: s.currency,
            everyMonths: s.everyMonths,
            anchorMonth: s.anchorMonth,
            expectedDay: s.expectedDay,
            validFrom: s.validFrom,
            validTo: s.validTo,
            amount: first!.amount,
          },
          userId,
        );
        for (const a of rest) await addIncomeSourceAmount(tx, created.id, a, userId);
        summary.incomeSources++;
      }

      for (const i of file.oneOffIncomes) {
        const where = `one-off income "${i.description}"`;
        current = where;
        const { category: cat, ...fields } = i;
        await createOneOffIncome(tx, { ...fields, categoryId: await categoryId(cat, 'income', where) }, userId);
        summary.oneOffIncomes++;
      }

      for (const e of file.recurringExpenses) {
        const where = `recurring expense "${e.name}"`;
        current = where;
        const [first, ...rest] = e.amounts;
        if (first!.fromPeriod !== e.validFrom) throw new ImportError(`${where}: the first amount must start in validFrom`);
        const created = await createRecurringExpense(
          tx,
          {
            name: e.name,
            class: e.class,
            provider: e.provider,
            categoryId: await categoryId(e.category, 'expense', where),
            propertyId: propertyId(e.property, where),
            beneficiaryId: e.beneficiary === null ? null : await personId(e.beneficiary, where),
            currency: e.currency,
            everyMonths: e.everyMonths,
            anchorMonth: e.anchorMonth,
            dueDay: e.dueDay,
            validFrom: e.validFrom,
            validTo: e.validTo,
            amount: first!.amount,
          },
          userId,
        );
        for (const a of rest) await addRecurringExpenseAmount(tx, created.id, a, userId);
        summary.recurringExpenses++;
      }

      for (const e of file.oneOffExpenses) {
        const where = `one-off expense "${e.description}"`;
        current = where;
        const { category: cat, property, ...fields } = e;
        await createOneOffExpense(
          tx,
          { ...fields, categoryId: await categoryId(cat, 'expense', where), propertyId: propertyId(property, where) },
          userId,
        );
        summary.oneOffExpenses++;
      }

      for (const c of file.creditCards) {
        const where = `card "${c.name}"`;
        current = where;
        const card = await createCreditCard(
          tx,
          {
            name: c.name,
            bank: c.bank,
            country: c.country,
            holderId: await personId(c.holder, where),
            closingDay: c.closingDay,
            dueDay: c.dueDay,
            estimatedSpendLocal: c.estimatedSpendLocal,
            estimatedSpendUsd: c.estimatedSpendUsd,
          },
          userId,
        );
        summary.creditCards++;
        for (const p of c.installmentPurchases) {
          const pWhere = `${where}, purchase "${p.description}"`;
          current = pWhere;
          // RNF-15: "4 de 12" in October's statement → installment 1 was in July
          const firstPeriod =
            p.firstPeriod ?? addMonths(toPeriod(p.currentInstallment!.period), -(p.currentInstallment!.number - 1));
          await createInstallmentPurchase(
            tx,
            {
              creditCardId: card.id,
              description: p.description,
              categoryId: await categoryId(p.category, 'expense', pWhere),
              purchaseDate: p.purchaseDate,
              currency: p.currency,
              installmentAmount: p.installmentAmount,
              installmentsTotal: p.installmentsTotal,
              firstPeriod,
            },
            userId,
          );
          summary.installmentPurchases++;
        }
        for (const s of c.subscriptions) {
          const sWhere = `${where}, subscription "${s.description}"`;
          current = sWhere;
          const { category: cat, ...fields } = s;
          await createSubscription(tx, { ...fields, creditCardId: card.id, categoryId: await categoryId(cat, 'expense', sWhere) }, userId);
          summary.subscriptions++;
        }
        for (const s of c.statements) {
          current = `${where}, statement due ${s.dueDate}`;
          await createCardStatement(tx, { ...s, creditCardId: card.id }, userId);
          summary.statements++;
        }
      }

      for (const l of file.loans) {
        const where = `loan "${l.lender}"`;
        current = where;
        const { holder, category: cat, ...terms } = l;
        await createLoan(
          tx,
          { ...terms, holderId: await personId(holder, where), categoryId: await categoryId(cat, 'expense', where) },
          userId,
        );
        summary.loans++;
      }

      if (dryRun) throw new DryRun(summary);
      return summary;
    });
  } catch (err) {
    if (err instanceof DryRun) return err.summary;
    if (err instanceof ServiceError) throw new ImportError(`${current}: ${err.reason ?? err.code}`);
    throw err;
  }
}
