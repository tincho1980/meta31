import { amortizationSystem, fieldErrors, type Loan, loanCreate, loanKind, loanUpdate } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { z } from 'zod';
import { api } from '../api';
import { DeleteButton } from '../components/DeleteButton';
import { Field } from '../components/Field';
import { type Choices, CURRENCIES, useChoices } from '../components/rules';
import {
  currentPeriodIso,
  formatDecimal,
  formatMoney,
  formatMonth,
  formatPercent,
  formatUva,
  monthInputToPeriod,
  parseDecimalInput,
  periodToMonthInput,
  todayIso,
} from '../format';
import { columnLabel, derivedLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

export const LOANS_KEY = ['loans'];
const TABLE = 'loan';

/** An amount of the schedule: in UVAs for UVA loans, else money in the loan currency. */
export const loanAmount = (loan: Pick<Loan, 'kind' | 'currency'>, value: string) =>
  loan.kind === 'uva' ? formatUva(value) : formatMoney(value, loan.currency);

export function Loans() {
  const list = useQuery({ queryKey: LOANS_KEY, queryFn: () => api<Loan[]>('GET', '/api/loans') });
  const choices = useChoices('expense');
  const [adding, setAdding] = useState(false);

  return (
    <section className="page">
      <div className="page-head">
        <h1>{tableLabel(TABLE, true)}</h1>
        {!adding && (
          <button type="button" className="primary" onClick={() => setAdding(true)}>
            {t('add')}
          </button>
        )}
      </div>
      <p className="muted">{t('loan_help')}</p>
      {adding && <CreateLoan choices={choices} onDone={() => setAdding(false)} />}
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          <ul className="rows">
            {list.data.map((l) => (
              <LoanRow key={l.id} loan={l} choices={choices} />
            ))}
          </ul>
        ))}
    </section>
  );
}

type FormState = {
  lender: string;
  holderId: string;
  categoryId: string;
  currency: string;
  kind: string;
  amortizationSystem: string;
  principal: string;
  principalUva: string;
  nominalAnnualRate: string;
  effectiveAnnualRate: string;
  totalFinancialCost: string;
  interestVatRate: string;
  monthlyInsurance: string;
  grantedDate: string;
  installmentsTotal: string;
  firstPeriod: string; // 'YYYY-MM'
  dueDay: string;
  quotedInstallment: string;
};

const emptyForm = (): FormState => ({
  lender: '',
  holderId: '',
  categoryId: '',
  currency: 'ARS',
  kind: 'fixed_rate',
  amortizationSystem: 'french',
  principal: '',
  principalUva: '',
  nominalAnnualRate: '',
  effectiveAnnualRate: '',
  totalFinancialCost: '',
  interestVatRate: '0',
  monthlyInsurance: '0',
  grantedDate: todayIso(),
  installmentsTotal: '',
  firstPeriod: periodToMonthInput(currentPeriodIso()),
  dueDay: '',
  quotedInstallment: '',
});

const decimalOrEmpty = (v: string | null) => (v === null ? '' : formatDecimal(v, 0));

const formOf = (l: Loan): FormState => ({
  lender: l.lender,
  holderId: l.holderId,
  categoryId: l.categoryId,
  currency: l.currency,
  kind: l.kind,
  amortizationSystem: l.amortizationSystem,
  principal: formatDecimal(l.principal),
  principalUva: decimalOrEmpty(l.principalUva),
  nominalAnnualRate: formatDecimal(l.nominalAnnualRate, 0),
  effectiveAnnualRate: decimalOrEmpty(l.effectiveAnnualRate),
  totalFinancialCost: decimalOrEmpty(l.totalFinancialCost),
  interestVatRate: formatDecimal(l.interestVatRate, 0),
  monthlyInsurance: formatDecimal(l.monthlyInsurance),
  grantedDate: l.grantedDate,
  installmentsTotal: String(l.installmentsTotal),
  firstPeriod: periodToMonthInput(l.firstPeriod),
  dueDay: String(l.dueDay),
  quotedInstallment: l.quotedInstallment === null ? '' : formatDecimal(l.quotedInstallment),
});

const optionalDecimal = (v: string) => (v.trim() === '' ? null : parseDecimalInput(v));
const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

const toInput = (f: FormState) => ({
  lender: f.lender,
  holderId: f.holderId || undefined,
  categoryId: f.categoryId || undefined,
  currency: f.kind === 'uva' ? 'ARS' : f.currency,
  kind: f.kind,
  amortizationSystem: f.amortizationSystem,
  principal: parseDecimalInput(f.principal),
  principalUva: f.kind === 'uva' ? optionalDecimal(f.principalUva) ?? '' : null,
  nominalAnnualRate: parseDecimalInput(f.nominalAnnualRate),
  effectiveAnnualRate: optionalDecimal(f.effectiveAnnualRate),
  totalFinancialCost: optionalDecimal(f.totalFinancialCost),
  interestVatRate: parseDecimalInput(f.interestVatRate),
  monthlyInsurance: parseDecimalInput(f.monthlyInsurance),
  grantedDate: f.grantedDate,
  installmentsTotal: num(f.installmentsTotal),
  firstPeriod: monthInputToPeriod(f.firstPeriod) || undefined,
  dueDay: num(f.dueDay),
  quotedInstallment: optionalDecimal(f.quotedInstallment),
});

type LoanFormProps = {
  initial: FormState;
  choices: Choices;
  schema: z.ZodType;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
  current?: Loan;
};

function LoanForm({ initial, choices, schema, pending, error, onSubmit, onCancel, current }: LoanFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(toInput(form));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    onSubmit(parsed.data);
  };

  const col = (c: string) => columnLabel(TABLE, c);
  const optional = (c: string) => `${col(c)} ${t('optional')}`;
  const categories = choices.categories.filter((c) => (c.active && !c.system) || c.id === current?.categoryId);
  const text = (field: keyof FormState, label: string, mode: 'decimal' | 'numeric' | 'text' = 'decimal') => (
    <Field label={label} error={errors[field]}>
      {(p) => <input {...p} inputMode={mode} value={form[field]} onChange={set(field)} />}
    </Field>
  );

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      {text('lender', col('lender'), 'text')}
      <Field label={col('holder_id')} error={errors.holderId}>
        {(p) => (
          <select {...p} value={form.holderId} onChange={set('holderId')}>
            <option value="" disabled>
              —
            </option>
            {choices.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('category_id')} error={errors.categoryId}>
        {(p) => (
          <select {...p} value={form.categoryId} onChange={set('categoryId')}>
            <option value="" disabled>
              —
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('kind')} error={errors.kind}>
        {(p) => (
          <select {...p} value={form.kind} onChange={set('kind')}>
            {loanKind.options.map((k) => (
              <option key={k} value={k}>
                {enumLabel('loan_kind', k)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {form.kind !== 'uva' && (
        <Field label={col('currency')} error={errors.currency}>
          {(p) => (
            <select {...p} value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {enumLabel('currency', c)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={col('amortization_system')} error={errors.amortizationSystem}>
        {(p) => (
          <select {...p} value={form.amortizationSystem} onChange={set('amortizationSystem')}>
            {amortizationSystem.options.map((s) => (
              <option key={s} value={s}>
                {enumLabel('amortization_system', s)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {text('principal', col('principal'))}
      {form.kind === 'uva' && text('principalUva', col('principal_uva'))}
      {text('nominalAnnualRate', col('nominal_annual_rate'))}
      {text('interestVatRate', col('interest_vat_rate'))}
      {text('monthlyInsurance', col('monthly_insurance'))}
      <Field label={col('granted_date')} error={errors.grantedDate}>
        {(p) => <input {...p} type="date" value={form.grantedDate} onChange={set('grantedDate')} />}
      </Field>
      {text('installmentsTotal', col('installments_total'), 'numeric')}
      <Field label={col('first_period')} error={errors.firstPeriod}>
        {(p) => <input {...p} type="month" value={form.firstPeriod} onChange={set('firstPeriod')} />}
      </Field>
      {text('dueDay', col('due_day'), 'numeric')}
      {text('effectiveAnnualRate', optional('effective_annual_rate'))}
      {text('totalFinancialCost', optional('total_financial_cost'))}
      {text('quotedInstallment', optional('quoted_installment'))}
      <p className="muted form-error">{t('loan_optional_help')}</p>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
      {error ? <p className="warning form-error">{errorMessage(error)}</p> : null}
    </form>
  );
}

function CreateLoan({ choices, onDone }: { choices: Choices; onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: unknown) => api<Loan>('POST', '/api/loans', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      onDone();
    },
  });
  return (
    <div className="card">
      <LoanForm
        initial={emptyForm()}
        choices={choices}
        schema={loanCreate}
        pending={create.isPending}
        error={create.error}
        onSubmit={(input) => {
          create.reset();
          create.mutate(input);
        }}
        onCancel={onDone}
      />
    </div>
  );
}

/** "Martín · Francés · TNA 65 % · cuota 7 de 18 · hasta septiembre 2027" */
function describe(loan: Loan, choices: Choices): string {
  const parts: string[] = [];
  const holder = choices.people.find((p) => p.id === loan.holderId);
  if (holder) parts.push(holder.name);
  parts.push(enumLabel('amortization_system', loan.amortizationSystem));
  if (loan.kind === 'uva') parts.push(enumLabel('loan_kind', 'uva'));
  parts.push(`TNA ${formatPercent(loan.nominalAnnualRate)}`);
  if (loan.currentInstallment) {
    parts.push(t('current_installment_short', { n: String(loan.currentInstallment.number), total: String(loan.installmentsTotal) }));
  }
  const now = currentPeriodIso();
  if (loan.firstPeriod > now) parts.push(t('starts_in', { month: formatMonth(loan.firstPeriod) }));
  else if (loan.lastPeriod >= now) parts.push(t('until_month', { month: formatMonth(loan.lastPeriod) }));
  else parts.push(t('ended_in', { month: formatMonth(loan.lastPeriod) }));
  return parts.join(' · ');
}

function LoanRow({ loan, choices }: { loan: Loan; choices: Choices }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (input: unknown) => api<Loan>('PATCH', `/api/loans/${loan.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      setEditing(false);
    },
  });
  const ended = loan.lastPeriod < currentPeriodIso();

  return (
    <li className={`row${ended ? ' inactive' : ''}`}>
      <span className="grow">
        <Link to={`/prestamos/${loan.id}`} className="row-link">
          {loan.lender}
        </Link>
        <span className="note">{describe(loan, choices)}</span>
      </span>
      {loan.currentInstallment && (
        <span className="amount estimate" title={derivedLabel('theoretical_installment')}>
          ~ {loanAmount(loan, loan.currentInstallment.total)}
        </span>
      )}
      {!editing && (
        <span className="actions">
          <Link to={`/prestamos/${loan.id}`} className="link">
            {t('view_schedule')}
          </Link>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
          <DeleteButton path={`/api/loans/${loan.id}`} name={loan.lender} queryKey={LOANS_KEY} />
        </span>
      )}
      {editing && (
        <div className="row-panel">
          <LoanForm
            initial={formOf(loan)}
            choices={choices}
            schema={loanUpdate}
            pending={update.isPending}
            error={update.error}
            current={loan}
            onSubmit={(input) => {
              update.reset();
              update.mutate(input);
            }}
            onCancel={() => {
              update.reset();
              setEditing(false);
            }}
          />
        </div>
      )}
    </li>
  );
}
