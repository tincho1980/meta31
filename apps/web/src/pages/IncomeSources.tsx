import { fieldErrors, type IncomeSource, incomeSourceCreate, incomeSourceUpdate } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { api } from '../api';
import { AmountHistory } from '../components/AmountHistory';
import { Field } from '../components/Field';
import { OneOffIncomes } from '../components/OneOffIncomes';
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

const KEY = ['income-sources'];
const TABLE = 'income_source';

export function IncomeSources() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<IncomeSource[]>('GET', '/api/income-sources') });
  const choices = useChoices('income');
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
      {adding && <CreateSource choices={choices} onDone={() => setAdding(false)} />}
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          <ul className="rows">
            {list.data.map((s) => (
              <SourceRow key={s.id} source={s} choices={choices} />
            ))}
          </ul>
        ))}
      <OneOffIncomes choices={choices} />
    </section>
  );
}

type FormState = {
  name: string;
  categoryId: string;
  holderId: string;
  propertyId: string;
  currency: string;
  amount: string;
  schedule: ScheduleForm;
};

const emptyForm = (): FormState => ({
  name: '',
  categoryId: '',
  holderId: '',
  propertyId: '',
  currency: 'ARS',
  amount: '',
  schedule: emptySchedule(),
});

const formOf = (s: IncomeSource): FormState => ({
  name: s.name,
  categoryId: s.categoryId,
  holderId: s.holderId ?? '',
  propertyId: s.propertyId ?? '',
  currency: s.currency,
  amount: '',
  schedule: scheduleOf(s, s.expectedDay),
});

/** Form texts → API input. Empty optional fields go as null. */
function toInput(form: FormState) {
  const { day, ...schedule } = scheduleInput(form.schedule);
  return {
    name: form.name,
    categoryId: form.categoryId || undefined,
    holderId: form.holderId || null,
    propertyId: form.propertyId || null,
    currency: form.currency,
    ...schedule,
    expectedDay: day,
  };
}

type SourceFormProps = {
  initial: FormState;
  choices: Choices;
  /** The new source carries its first amount; editing goes through the history. */
  withAmount: boolean;
  schema: z.ZodType;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
  /** Source being edited: its category and property stay in the lists even if inactive. */
  current?: IncomeSource;
};

function SourceForm({ initial, choices, withAmount, schema, pending, error, onSubmit, onCancel, current }: SourceFormProps) {
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

  const categories = choices.categories.filter((c) => c.active || c.id === current?.categoryId);
  const properties = choices.properties.filter((p) => p.active || p.id === current?.propertyId);
  const col = (c: string) => columnLabel(TABLE, c);

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('name')} error={errors.name}>
        {(p) => <input {...p} value={form.name} onChange={set('name')} />}
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
      <Field label={col('holder_id')} error={errors.holderId}>
        {(p) => (
          <select {...p} value={form.holderId} onChange={set('holderId')}>
            <option value="">{t('no_holder')}</option>
            {choices.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
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
      {withAmount && (
        <Field label={t('first_amount')} error={errors.amount}>
          {(p) => <input {...p} inputMode="decimal" value={form.amount} onChange={set('amount')} />}
        </Field>
      )}
      <ScheduleFields
        table={TABLE}
        dayColumn="expected_day"
        dayField="expectedDay"
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

function CreateSource({ choices, onDone }: { choices: Choices; onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: unknown) => api<IncomeSource>('POST', '/api/income-sources', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      onDone();
    },
  });
  return (
    <div className="card">
      <SourceForm
        initial={emptyForm()}
        choices={choices}
        withAmount
        schema={incomeSourceCreate}
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

/** "Mensual · Martín · Pocitos · hasta marzo 2027" */
function describe(source: IncomeSource, choices: Choices): string {
  const [frequency, ...validity] = describeSchedule(source);
  const parts = [frequency!];
  const holder = choices.people.find((p) => p.id === source.holderId);
  if (holder) parts.push(holder.name);
  const property = choices.properties.find((p) => p.id === source.propertyId);
  if (property) parts.push(property.name);
  return [...parts, ...validity].join(' · ');
}

function SourceRow({ source, choices }: { source: IncomeSource; choices: Choices }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit' | 'amounts'>('view');
  const update = useMutation({
    mutationFn: (input: unknown) => api<IncomeSource>('PATCH', `/api/income-sources/${source.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setMode('view');
    },
  });
  const amount = currentAmount(source.amounts);

  return (
    <li className={`row${hasEnded(source) ? ' inactive' : ''}`}>
      <span className="grow">
        {source.name}
        <span className="note">{describe(source, choices)}</span>
      </span>
      {amount && <span className="amount income">{formatMoney(amount.amount, source.currency, { income: true })}</span>}
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
          <SourceForm
            initial={formOf(source)}
            choices={choices}
            withAmount={false}
            schema={incomeSourceUpdate}
            pending={update.isPending}
            error={update.error}
            current={source}
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
          path={`/api/income-sources/${source.id}`}
          table="income_source_amount"
          help={t('income_amount_help')}
          amounts={source.amounts}
          currency={source.currency}
          queryKey={KEY}
          onClose={() => setMode('view')}
        />
      )}
    </li>
  );
}
