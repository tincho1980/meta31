import {
  type Category,
  EVERY_MONTHS,
  fieldErrors,
  type IncomeSource,
  type IncomeSourceAmount,
  incomeSourceAmountCreate,
  incomeSourceAmountUpdate,
  incomeSourceCreate,
  incomeSourceUpdate,
  type Person,
  type Property,
} from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { api } from '../api';
import { Field } from '../components/Field';
import {
  currentPeriodIso,
  formatDecimal,
  formatMoney,
  formatMonth,
  monthInputToPeriod,
  monthName,
  parseDecimalInput,
  periodToMonthInput,
} from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

const CURRENCIES = ['ARS', 'USD', 'UYU'] as const;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const KEY = ['income-sources'];

/** Lists the form needs; inactive entries are offered only if the source already uses them. */
function useChoices() {
  const categories = useQuery({
    queryKey: ['categories', 'income'],
    queryFn: () => api<Category[]>('GET', '/api/categories?kind=income'),
  });
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('GET', '/api/people') });
  const properties = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('GET', '/api/properties') });
  return { categories: categories.data ?? [], people: people.data ?? [], properties: properties.data ?? [] };
}

/** Amount in force this month: the last one that already started, or the first one if none did. */
function currentAmount(source: IncomeSource): IncomeSourceAmount | undefined {
  const now = currentPeriodIso();
  return source.amounts.filter((a) => a.fromPeriod <= now).at(-1) ?? source.amounts[0];
}

export function IncomeSources() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<IncomeSource[]>('GET', '/api/income-sources') });
  const choices = useChoices();
  const [adding, setAdding] = useState(false);

  return (
    <section className="page">
      <div className="page-head">
        <h1>{tableLabel('income_source', true)}</h1>
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
    </section>
  );
}

type Choices = ReturnType<typeof useChoices>;

type FormState = {
  name: string;
  categoryId: string;
  holderId: string;
  propertyId: string;
  currency: string;
  everyMonths: string;
  anchorMonth: string;
  expectedDay: string;
  validFrom: string; // 'YYYY-MM'
  validTo: string; // 'YYYY-MM' or ''
  amount: string;
};

const emptyForm = (): FormState => {
  const month = periodToMonthInput(currentPeriodIso());
  return {
    name: '',
    categoryId: '',
    holderId: '',
    propertyId: '',
    currency: 'ARS',
    everyMonths: '1',
    anchorMonth: String(Number(month.slice(5, 7))),
    expectedDay: '',
    validFrom: month,
    validTo: '',
    amount: '',
  };
};

const formOf = (s: IncomeSource): FormState => ({
  name: s.name,
  categoryId: s.categoryId,
  holderId: s.holderId ?? '',
  propertyId: s.propertyId ?? '',
  currency: s.currency,
  everyMonths: String(s.everyMonths),
  anchorMonth: String(s.anchorMonth),
  expectedDay: s.expectedDay === null ? '' : String(s.expectedDay),
  validFrom: periodToMonthInput(s.validFrom),
  validTo: periodToMonthInput(s.validTo),
  amount: '',
});

/** Form texts → API input. Empty optional fields go as null; numbers as numbers, amounts as strings. */
function toInput(form: FormState) {
  const everyMonths = Number(form.everyMonths);
  return {
    name: form.name,
    categoryId: form.categoryId || undefined,
    holderId: form.holderId || null,
    propertyId: form.propertyId || null,
    currency: form.currency,
    everyMonths,
    // monthly sources do not need a reference month; keep a valid one
    anchorMonth: everyMonths === 1 ? 1 : Number(form.anchorMonth),
    expectedDay: form.expectedDay.trim() === '' ? null : Number(form.expectedDay),
    validFrom: monthInputToPeriod(form.validFrom) || undefined,
    validTo: monthInputToPeriod(form.validTo) || null,
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
  /** Ids already used by the source, kept in the lists even if inactive. */
  current?: IncomeSource;
};

function SourceForm({ initial, choices, withAmount, schema, pending, error, onSubmit, onCancel, current }: SourceFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
  const col = (c: string) => columnLabel('income_source', c);

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
      <Field label={col('every_months')} error={errors.everyMonths}>
        {(p) => (
          <select {...p} value={form.everyMonths} onChange={set('everyMonths')}>
            {EVERY_MONTHS.map((n) => (
              <option key={n} value={n}>
                {t(`every_months_${n}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {form.everyMonths !== '1' && (
        <Field label={col('anchor_month')} error={errors.anchorMonth}>
          {(p) => (
            <select {...p} value={form.anchorMonth} onChange={set('anchorMonth')} title={t('anchor_month_help')}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={col('expected_day')} error={errors.expectedDay}>
        {(p) => <input {...p} inputMode="numeric" value={form.expectedDay} onChange={set('expectedDay')} />}
      </Field>
      <Field label={col('valid_from')} error={errors.validFrom}>
        {(p) => <input {...p} type="month" value={form.validFrom} onChange={set('validFrom')} />}
      </Field>
      <Field label={col('valid_to')} error={errors.validTo}>
        {(p) => <input {...p} type="month" value={form.validTo} onChange={set('validTo')} title={t('valid_to_help')} />}
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
  const parts = [t(`every_months_${source.everyMonths}`)];
  const holder = choices.people.find((p) => p.id === source.holderId);
  if (holder) parts.push(holder.name);
  const property = choices.properties.find((p) => p.id === source.propertyId);
  if (property) parts.push(property.name);
  const now = currentPeriodIso();
  if (source.validFrom > now) parts.push(t('since_month', { month: formatMonth(source.validFrom) }));
  if (source.validTo) parts.push(t('until_month', { month: formatMonth(source.validTo) }));
  return parts.join(' · ');
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
  const amount = currentAmount(source);
  const ended = source.validTo !== null && source.validTo < currentPeriodIso();

  return (
    <li className={`row${ended ? ' inactive' : ''}`}>
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
      {mode === 'amounts' && <AmountHistory source={source} onClose={() => setMode('view')} />}
    </li>
  );
}

/** Amount history (rule 7): each amount applies from its month until the next one. */
function AmountHistory({ source, onClose }: { source: IncomeSource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ fromPeriod: periodToMonthInput(currentPeriodIso()), amount: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: (input: unknown) => api<IncomeSource>('POST', `/api/income-sources/${source.id}/amounts`, input),
    onSuccess: () => {
      setForm((f) => ({ ...f, amount: '' }));
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.reset();
    const parsed = incomeSourceAmountCreate.safeParse({
      fromPeriod: monthInputToPeriod(form.fromPeriod),
      amount: parseDecimalInput(form.amount),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    add.mutate(parsed.data);
  };

  return (
    <div className="row-panel">
      <h2>{tableLabel('income_source_amount', true)}</h2>
      <p className="muted">{t('income_amount_help')}</p>
      <ul className="rows nested">
        {[...source.amounts].reverse().map((a) => (
          <AmountRow key={a.id} source={source} amount={a} />
        ))}
      </ul>
      <form className="form-inline" onSubmit={submit} noValidate>
        <Field label={columnLabel('income_source_amount', 'from_period')} error={errors.fromPeriod}>
          {(p) => <input {...p} type="month" value={form.fromPeriod} onChange={(e) => setForm({ ...form, fromPeriod: e.target.value })} />}
        </Field>
        <Field label={t('new_amount')} error={errors.amount}>
          {(p) => <input {...p} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}
        </Field>
        <button type="submit" className="primary" disabled={add.isPending}>
          {add.isPending ? t('saving') : t('add')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
        {add.isError && <p className="warning form-error">{errorMessage(add.error)}</p>}
      </form>
    </div>
  );
}

function AmountRow({ source, amount }: { source: IncomeSource; amount: IncomeSourceAmount }) {
  const queryClient = useQueryClient();
  const initial = { fromPeriod: periodToMonthInput(amount.fromPeriod), amount: formatDecimal(amount.amount) };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useMutation({
    mutationFn: (input: unknown) =>
      api<IncomeSource>('PATCH', `/api/income-sources/${source.id}/amounts/${amount.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setEditing(false);
    },
  });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    update.reset();
    const parsed = incomeSourceAmountUpdate.safeParse({
      fromPeriod: monthInputToPeriod(form.fromPeriod),
      amount: parseDecimalInput(form.amount),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    update.mutate(parsed.data);
  };

  if (editing) {
    return (
      <li className="row">
        <form className="form-inline grow" onSubmit={save} noValidate>
          <Field label={columnLabel('income_source_amount', 'from_period')} error={errors.fromPeriod}>
            {(p) => <input {...p} type="month" value={form.fromPeriod} onChange={(e) => setForm({ ...form, fromPeriod: e.target.value })} />}
          </Field>
          <Field label={columnLabel('income_source_amount', 'amount')} error={errors.amount}>
            {(p) => <input {...p} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}
          </Field>
          <button type="submit" className="primary" disabled={update.isPending}>
            {t('save')}
          </button>
          <button type="button" className="secondary" onClick={() => { setEditing(false); setForm(initial); update.reset(); }}>
            {t('cancel')}
          </button>
          {update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
        </form>
      </li>
    );
  }

  return (
    <li className="row">
      <span className="grow">{t('since_month', { month: formatMonth(amount.fromPeriod) })}</span>
      <span className="amount">{formatMoney(amount.amount, source.currency)}</span>
      <span className="actions">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          {t('edit')}
        </button>
      </span>
    </li>
  );
}
