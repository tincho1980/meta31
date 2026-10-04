import { fieldErrors, type OneOffIncome, oneOffIncomeCreate, oneOffIncomeUpdate } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { api } from '../api';
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
import { columnLabel, enumLabel, errorMessage, t } from '../glossary';
import { DeleteButton } from './DeleteButton';
import { Field } from './Field';
import { type Choices, CURRENCIES } from './rules';

const KEY = ['one-off-incomes'];

type FormState = { description: string; categoryId: string; currency: string; estimatedAmount: string; expectedDate: string; period: string };

const emptyForm = (): FormState => ({
  description: '',
  categoryId: '',
  currency: 'ARS',
  estimatedAmount: '',
  expectedDate: '',
  period: periodToMonthInput(currentPeriodIso()),
});

const formOf = (i: OneOffIncome): FormState => ({
  description: i.description,
  categoryId: i.categoryId,
  currency: i.currency,
  estimatedAmount: formatDecimal(i.estimatedAmount),
  expectedDate: i.expectedDate ?? '',
  period: periodToMonthInput(i.period),
});

/** One-off incomes (RF-09): extras, projects, substitutions, each in its month. */
export function OneOffIncomes({ choices }: { choices: Choices }) {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<OneOffIncome[]>('GET', '/api/one-off-incomes') });
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const create = useMutation({
    mutationFn: (input: unknown) => api('POST', '/api/one-off-incomes', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setAdding(false);
    },
  });

  return (
    <div className="group">
      <div className="page-head">
        <h2>{t('one_off_incomes')}</h2>
        {!adding && (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            {t('add')}
          </button>
        )}
      </div>
      <p className="muted">{t('one_off_income_help')}</p>
      {adding && (
        <div className="card">
          <IncomeForm
            choices={choices}
            initial={emptyForm()}
            schema={oneOffIncomeCreate}
            pending={create.isPending}
            error={create.error}
            onSubmit={(input) => {
              create.reset();
              create.mutate(input);
            }}
            onCancel={() => {
              create.reset();
              setAdding(false);
            }}
          />
        </div>
      )}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          <ul className="rows">
            {list.data.map((i) => (
              <IncomeRow key={i.id} income={i} choices={choices} />
            ))}
          </ul>
        ))}
    </div>
  );
}

function IncomeForm({ choices, initial, schema, pending, error, onSubmit, onCancel, currentCategoryId }: {
  choices: Choices;
  initial: FormState;
  schema: z.ZodType;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
  currentCategoryId?: string;
}) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: e.target.value });
  // the expected date sets the month
  const setDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const expectedDate = e.target.value;
    setForm({ ...form, expectedDate, period: expectedDate ? expectedDate.slice(0, 7) : form.period });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      description: form.description,
      categoryId: form.categoryId || undefined,
      currency: form.currency,
      estimatedAmount: parseDecimalInput(form.estimatedAmount),
      expectedDate: form.expectedDate || null,
      period: monthInputToPeriod(form.period) || undefined,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    onSubmit(parsed.data);
  };

  const col = (c: string) => columnLabel('income', c);
  const categories = choices.categories.filter((c) => c.active || c.id === currentCategoryId);
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
      <Field label={col('estimated_amount')} error={errors.estimatedAmount}>
        {(p) => <input {...p} inputMode="decimal" value={form.estimatedAmount} onChange={set('estimatedAmount')} />}
      </Field>
      <Field label={col('expected_date')} error={errors.expectedDate}>
        {(p) => <input {...p} type="date" value={form.expectedDate} onChange={setDate} />}
      </Field>
      <Field label={col('period')} error={errors.period}>
        {(p) => <input {...p} type="month" value={form.period} onChange={set('period')} />}
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

function IncomeRow({ income, choices }: { income: OneOffIncome; choices: Choices }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (input: unknown) => api('PATCH', `/api/one-off-incomes/${income.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setEditing(false);
    },
  });
  const expected = income.status === 'expected';
  const note = income.expectedDate ? formatDate(income.expectedDate) : formatMonth(income.period);
  const past = income.period < currentPeriodIso();

  return (
    <li className={`row${!expected || past ? ' inactive' : ''}`}>
      <span className="grow">
        {income.description}
        <span className="note">
          {note}
          {!expected && ` · ${enumLabel('income_status', income.status)}`}
        </span>
      </span>
      <span className="amount income">{formatMoney(income.actualAmount ?? income.estimatedAmount, income.currency, { income: true })}</span>
      {expected && !editing && (
        <span className="actions">
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
          <DeleteButton path={`/api/one-off-incomes/${income.id}`} name={income.description} queryKey={KEY} />
        </span>
      )}
      {editing && (
        <div className="row-panel">
          <IncomeForm
            choices={choices}
            initial={formOf(income)}
            schema={oneOffIncomeUpdate}
            pending={update.isPending}
            error={update.error}
            currentCategoryId={income.categoryId}
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
