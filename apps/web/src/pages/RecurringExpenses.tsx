import { expenseClass, fieldErrors, type RecurringExpense, recurringExpenseCreate, recurringExpenseUpdate } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { api } from '../api';
import { AmountHistory } from '../components/AmountHistory';
import { Field } from '../components/Field';
import {
  type Choices,
  CURRENCIES,
  currentAmount,
  describeSchedule,
  emptySchedule,
  hasEnded,
  type ScheduleForm,
  ScheduleFields,
  scheduleInput,
  scheduleOf,
  useChoices,
} from '../components/rules';
import { formatMoney, parseDecimalInput } from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

const KEY = ['recurring-expenses'];
const TABLE = 'recurring_expense';
const CLASSES = expenseClass.options;

export function RecurringExpenses() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<RecurringExpense[]>('GET', '/api/recurring-expenses') });
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
      <p className="muted">{t('recurring_expense_help')}</p>
      {adding && <CreateExpense choices={choices} onDone={() => setAdding(false)} />}
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          CLASSES.map((cls) => {
            const items = list.data.filter((e) => e.class === cls);
            if (items.length === 0) return null;
            return (
              <div key={cls} className="group">
                <h2>{enumLabel('expense_class', cls)}</h2>
                <ul className="rows">
                  {items.map((e) => (
                    <ExpenseRow key={e.id} expense={e} choices={choices} />
                  ))}
                </ul>
              </div>
            );
          })
        ))}
    </section>
  );
}

type FormState = {
  name: string;
  class: string;
  provider: string;
  categoryId: string;
  propertyId: string;
  beneficiaryId: string;
  currency: string;
  amount: string;
  schedule: ScheduleForm;
};

const emptyForm = (): FormState => ({
  name: '',
  class: 'utility',
  provider: '',
  categoryId: '',
  propertyId: '',
  beneficiaryId: '',
  currency: 'ARS',
  amount: '',
  schedule: emptySchedule(),
});

const formOf = (e: RecurringExpense): FormState => ({
  name: e.name,
  class: e.class,
  provider: e.provider ?? '',
  categoryId: e.categoryId,
  propertyId: e.propertyId ?? '',
  beneficiaryId: e.beneficiaryId ?? '',
  currency: e.currency,
  amount: '',
  schedule: scheduleOf(e, e.dueDay),
});

/** Form texts → API input. Empty optional fields go as null. */
function toInput(form: FormState) {
  const { day, ...schedule } = scheduleInput(form.schedule);
  return {
    name: form.name,
    class: form.class,
    provider: form.provider.trim() === '' ? null : form.provider,
    categoryId: form.categoryId || undefined,
    propertyId: form.propertyId || null,
    beneficiaryId: form.beneficiaryId || null,
    currency: form.currency,
    ...schedule,
    dueDay: day,
  };
}

type ExpenseFormProps = {
  initial: FormState;
  choices: Choices;
  /** The new expense carries its first amount; editing goes through the history. */
  withAmount: boolean;
  schema: z.ZodType;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
  /** Expense being edited: its category and property stay in the lists even if inactive. */
  current?: RecurringExpense;
};

function ExpenseForm({ initial, choices, withAmount, schema, pending, error, onSubmit, onCancel, current }: ExpenseFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: Exclude<keyof FormState, 'schedule'>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = withAmount ? { ...toInput(form), amount: parseDecimalInput(form.amount) } : toInput(form);
    const parsed = schema.safeParse(input);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    onSubmit(parsed.data);
  };

  const categories = choices.categories.filter((c) => (c.active && !c.system) || c.id === current?.categoryId);
  const properties = choices.properties.filter((p) => p.active || p.id === current?.propertyId);
  const col = (c: string) => columnLabel(TABLE, c);

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('name')} error={errors.name}>
        {(p) => <input {...p} value={form.name} onChange={set('name')} />}
      </Field>
      <Field label={col('class')} error={errors.class}>
        {(p) => (
          <select {...p} value={form.class} onChange={set('class')}>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {enumLabel('expense_class', c)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('provider')} error={errors.provider}>
        {(p) => <input {...p} value={form.provider} onChange={set('provider')} />}
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
      <Field label={col('beneficiary_id')} error={errors.beneficiaryId}>
        {(p) => (
          <select {...p} value={form.beneficiaryId} onChange={set('beneficiaryId')}>
            <option value="">{t('no_beneficiary')}</option>
            {choices.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
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
      {withAmount && (
        <Field label={t('first_estimated_amount')} error={errors.amount}>
          {(p) => <input {...p} inputMode="decimal" value={form.amount} onChange={set('amount')} />}
        </Field>
      )}
      <ScheduleFields
        table={TABLE}
        dayColumn="due_day"
        dayField="dueDay"
        value={form.schedule}
        onChange={(schedule) => setForm({ ...form, schedule })}
        errors={errors}
      />
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
    mutationFn: (input: unknown) => api<RecurringExpense>('POST', '/api/recurring-expenses', input),
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
        withAmount
        schema={recurringExpenseCreate}
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

/** "Mensual · Edelap · Casa La Plata · vence el 20" */
function describe(expense: RecurringExpense, choices: Choices): string {
  const [frequency, ...validity] = describeSchedule(expense);
  const parts = [frequency!];
  if (expense.provider) parts.push(expense.provider);
  const property = choices.properties.find((p) => p.id === expense.propertyId);
  if (property) parts.push(property.name);
  const beneficiary = choices.people.find((p) => p.id === expense.beneficiaryId);
  if (beneficiary) parts.push(beneficiary.name);
  if (expense.dueDay) parts.push(t('due_on_day', { day: String(expense.dueDay) }));
  return [...parts, ...validity].join(' · ');
}

function ExpenseRow({ expense, choices }: { expense: RecurringExpense; choices: Choices }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit' | 'amounts'>('view');
  const update = useMutation({
    mutationFn: (input: unknown) => api<RecurringExpense>('PATCH', `/api/recurring-expenses/${expense.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setMode('view');
    },
  });
  const amount = currentAmount(expense.amounts);

  return (
    <li className={`row${hasEnded(expense) ? ' inactive' : ''}`}>
      <span className="grow">
        {expense.name}
        <span className="note">{describe(expense, choices)}</span>
      </span>
      {amount && <span className="amount estimate">{formatMoney(amount.amount, expense.currency, { estimate: true })}</span>}
      {mode === 'view' && (
        <span className="actions">
          <button type="button" className="link" onClick={() => setMode('edit')}>
            {t('edit')}
          </button>
          <button type="button" className="link" onClick={() => setMode('amounts')}>
            {t('amounts')}
          </button>
        </span>
      )}
      {mode === 'edit' && (
        <div className="row-panel">
          <ExpenseForm
            initial={formOf(expense)}
            choices={choices}
            withAmount={false}
            schema={recurringExpenseUpdate}
            pending={update.isPending}
            error={update.error}
            current={expense}
            onSubmit={(input) => {
              update.reset();
              update.mutate(input);
            }}
            onCancel={() => {
              update.reset();
              setMode('view');
            }}
          />
        </div>
      )}
      {mode === 'amounts' && (
        <AmountHistory
          path={`/api/recurring-expenses/${expense.id}`}
          table="recurring_expense_amount"
          help={t('expense_amount_help')}
          amounts={expense.amounts}
          currency={expense.currency}
          queryKey={KEY}
          onClose={() => setMode('view')}
        />
      )}
    </li>
  );
}
