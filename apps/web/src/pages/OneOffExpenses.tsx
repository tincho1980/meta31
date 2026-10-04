import { fieldErrors, type OneOffExpense, oneOffExpenseCreate, oneOffExpenseUpdate } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { api } from '../api';
import { DeleteButton } from '../components/DeleteButton';
import { Field } from '../components/Field';
import { type Choices, CURRENCIES, useChoices } from '../components/rules';
import {
  currentPeriodIso,
  formatDate,
  formatDecimal,
  formatMoney,
  formatMonth,
  monthInputToPeriod,
  parseDecimalInput,
  periodToMonthInput,
} from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

const KEY = ['one-off-expenses'];
const TABLE = 'one_off_expense';

export function OneOffExpenses() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<OneOffExpense[]>('GET', '/api/one-off-expenses') });
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
      <p className="muted">{t('one_off_expense_help')}</p>
      {adding && <CreateExpense choices={choices} onDone={() => setAdding(false)} />}
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          <ul className="rows">
            {list.data.map((e) => (
              <ExpenseRow key={e.id} expense={e} choices={choices} />
            ))}
          </ul>
        ))}
    </section>
  );
}

type FormState = {
  description: string;
  categoryId: string;
  propertyId: string;
  currency: string;
  totalAmount: string;
  installments: string;
  plannedDate: string;
  firstPeriod: string; // 'YYYY-MM'
};

const emptyForm = (): FormState => ({
  description: '',
  categoryId: '',
  propertyId: '',
  currency: 'ARS',
  totalAmount: '',
  installments: '1',
  plannedDate: '',
  firstPeriod: periodToMonthInput(currentPeriodIso()),
});

const formOf = (e: OneOffExpense): FormState => ({
  description: e.description,
  categoryId: e.categoryId,
  propertyId: e.propertyId ?? '',
  currency: e.currency,
  totalAmount: formatDecimal(e.totalAmount),
  installments: String(e.installments),
  plannedDate: e.plannedDate ?? '',
  firstPeriod: periodToMonthInput(e.firstPeriod),
});

const toInput = (form: FormState) => ({
  description: form.description,
  categoryId: form.categoryId || undefined,
  propertyId: form.propertyId || null,
  currency: form.currency,
  totalAmount: parseDecimalInput(form.totalAmount),
  installments: Number(form.installments),
  firstPeriod: monthInputToPeriod(form.firstPeriod) || undefined,
  plannedDate: form.plannedDate || null,
});

type ExpenseFormProps = {
  initial: FormState;
  choices: Choices;
  schema: z.ZodType;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
  /** Expense being edited: its category and property stay in the lists even if inactive. */
  current?: OneOffExpense;
};

function ExpenseForm({ initial, choices, schema, pending, error, onSubmit, onCancel, current }: ExpenseFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: e.target.value });

  // the planned date is the first payment: its month becomes the first month
  const setPlannedDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const plannedDate = e.target.value;
    setForm({ ...form, plannedDate, firstPeriod: plannedDate ? plannedDate.slice(0, 7) : form.firstPeriod });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(toInput(form));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    onSubmit(parsed.data);
  };

  const categories = choices.categories.filter((c) => (c.active && !c.system) || c.id === current?.categoryId);
  const properties = choices.properties.filter((p) => p.active || p.id === current?.propertyId);
  const col = (c: string) => columnLabel(TABLE, c);

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('description')} error={errors.description}>
        {(p) => <input {...p} value={form.description} onChange={set('description')} />}
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
      <Field label={col('property_id')} error={errors.propertyId}>
        {(p) => (
          <select {...p} value={form.propertyId} onChange={set('propertyId')}>
            <option value="">{t('no_property')}</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        )}
      </Field>
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
      <Field label={col('total_amount')} error={errors.totalAmount}>
        {(p) => <input {...p} inputMode="decimal" value={form.totalAmount} onChange={set('totalAmount')} />}
      </Field>
      <Field label={col('installments')} error={errors.installments}>
        {(p) => <input {...p} inputMode="numeric" value={form.installments} onChange={set('installments')} />}
      </Field>
      <Field label={col('planned_date')} error={errors.plannedDate}>
        {(p) => <input {...p} type="date" value={form.plannedDate} onChange={setPlannedDate} />}
      </Field>
      <Field label={col('first_period')} error={errors.firstPeriod}>
        {(p) => <input {...p} type="month" value={form.firstPeriod} onChange={set('firstPeriod')} />}
      </Field>
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

function CreateExpense({ choices, onDone }: { choices: Choices; onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: unknown) => api<OneOffExpense>('POST', '/api/one-off-expenses', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      onDone();
    },
  });
  return (
    <div className="card">
      <ExpenseForm
        initial={emptyForm()}
        choices={choices}
        schema={oneOffExpenseCreate}
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

/** "3 cuotas de $ 333.333 · noviembre 2026 a enero 2027 · La Plata" or "Un pago · 10/11/2026". */
function describe(e: OneOffExpense, choices: Choices): string {
  const parts: string[] = [];
  if (e.installments === 1) {
    parts.push(t('single_payment'), e.plannedDate ? formatDate(e.plannedDate) : formatMonth(e.firstPeriod));
  } else {
    parts.push(
      t('installments_of', { n: String(e.installments), amount: formatMoney(e.installmentAmount, e.currency) }),
      t('period_range', { from: formatMonth(e.firstPeriod), to: formatMonth(e.lastPeriod) }),
    );
  }
  const property = choices.properties.find((p) => p.id === e.propertyId);
  if (property) parts.push(property.name);
  return parts.join(' · ');
}

function ExpenseRow({ expense, choices }: { expense: OneOffExpense; choices: Choices }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (input: unknown) => api<OneOffExpense>('PATCH', `/api/one-off-expenses/${expense.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setEditing(false);
    },
  });
  const done = expense.lastPeriod < currentPeriodIso();

  return (
    <li className={`row${done ? ' inactive' : ''}`}>
      <span className="grow">
        {expense.description}
        <span className="note">{describe(expense, choices)}</span>
      </span>
      <span className="amount">{formatMoney(expense.totalAmount, expense.currency)}</span>
      {!editing && (
        <span className="actions">
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
          <DeleteButton path={`/api/one-off-expenses/${expense.id}`} name={expense.description} queryKey={KEY} />
        </span>
      )}
      {editing && (
        <div className="row-panel">
          <p className="muted">{t('one_off_edit_help')}</p>
          <ExpenseForm
            initial={formOf(expense)}
            choices={choices}
            schema={oneOffExpenseUpdate}
            pending={update.isPending}
            error={update.error}
            current={expense}
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
