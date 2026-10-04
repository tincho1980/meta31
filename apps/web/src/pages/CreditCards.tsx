import { type CreditCard, creditCardCreate, creditCardUpdate, fieldErrors, localCurrencyOf, type Person } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { z } from 'zod';
import { api } from '../api';
import { Field } from '../components/Field';
import { formatDecimal, formatMoney, parseDecimalInput } from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

const COUNTRIES = ['AR', 'UY'] as const;
const KEY = ['credit-cards'];
const TABLE = 'credit_card';

export function CreditCards() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<CreditCard[]>('GET', '/api/credit-cards') });
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('GET', '/api/people') });
  const [adding, setAdding] = useState(false);
  const peopleList = people.data ?? [];

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
      {adding && <CreateCard people={peopleList} onDone={() => setAdding(false)} />}
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          <ul className="rows">
            {list.data.map((c) => (
              <CardRow key={c.id} card={c} people={peopleList} />
            ))}
          </ul>
        ))}
    </section>
  );
}

type FormState = {
  name: string;
  bank: string;
  country: 'AR' | 'UY';
  holderId: string;
  closingDay: string;
  dueDay: string;
  estimatedSpendLocal: string;
  estimatedSpendUsd: string;
};

const emptyForm = (): FormState => ({
  name: '',
  bank: '',
  country: 'AR',
  holderId: '',
  closingDay: '',
  dueDay: '',
  estimatedSpendLocal: '0',
  estimatedSpendUsd: '0',
});

const formOf = (c: CreditCard): FormState => ({
  name: c.name,
  bank: c.bank,
  country: c.country,
  holderId: c.holderId,
  closingDay: String(c.closingDay),
  dueDay: String(c.dueDay),
  estimatedSpendLocal: formatDecimal(c.estimatedSpendLocal),
  estimatedSpendUsd: formatDecimal(c.estimatedSpendUsd),
});

const day = (v: string) => (v.trim() === '' ? undefined : Number(v));

const toInput = (form: FormState) => ({
  name: form.name,
  bank: form.bank,
  country: form.country,
  holderId: form.holderId || undefined,
  closingDay: day(form.closingDay),
  dueDay: day(form.dueDay),
  estimatedSpendLocal: parseDecimalInput(form.estimatedSpendLocal),
  estimatedSpendUsd: parseDecimalInput(form.estimatedSpendUsd),
});

type CardFormProps = {
  initial: FormState;
  people: Person[];
  schema: z.ZodType;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
};

function CardForm({ initial, people, schema, pending, error, onSubmit, onCancel }: CardFormProps) {
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
  const local = localCurrencyOf(form.country);

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('name')} error={errors.name}>
        {(p) => <input {...p} value={form.name} onChange={set('name')} />}
      </Field>
      <Field label={col('bank')} error={errors.bank}>
        {(p) => <input {...p} value={form.bank} onChange={set('bank')} />}
      </Field>
      <Field label={col('country')} error={errors.country}>
        {(p) => (
          <select {...p} value={form.country} onChange={set('country')} title={t('card_currency_help')}>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {enumLabel('country', c)} · {enumLabel('currency', localCurrencyOf(c))}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('holder_id')} error={errors.holderId}>
        {(p) => (
          <select {...p} value={form.holderId} onChange={set('holderId')}>
            <option value="" disabled>
              —
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('closing_day')} error={errors.closingDay}>
        {(p) => <input {...p} inputMode="numeric" value={form.closingDay} onChange={set('closingDay')} />}
      </Field>
      <Field label={col('due_day')} error={errors.dueDay}>
        {(p) => <input {...p} inputMode="numeric" value={form.dueDay} onChange={set('dueDay')} />}
      </Field>
      <Field label={`${t('estimated_spend')} (${local})`} error={errors.estimatedSpendLocal}>
        {(p) => <input {...p} inputMode="decimal" value={form.estimatedSpendLocal} onChange={set('estimatedSpendLocal')} />}
      </Field>
      <Field label={`${t('estimated_spend')} (USD)`} error={errors.estimatedSpendUsd}>
        {(p) => <input {...p} inputMode="decimal" value={form.estimatedSpendUsd} onChange={set('estimatedSpendUsd')} />}
      </Field>
      <p className="muted form-error">{t('estimated_spend_help')}</p>
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

function CreateCard({ people, onDone }: { people: Person[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: unknown) => api<CreditCard>('POST', '/api/credit-cards', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      onDone();
    },
  });
  return (
    <div className="card">
      <CardForm
        initial={emptyForm()}
        people={people}
        schema={creditCardCreate}
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

/** "Provincia · Martín · cierra el 25 · vence el 8" */
function describe(card: CreditCard, people: Person[]): string {
  const parts = [card.bank];
  const holder = people.find((p) => p.id === card.holderId);
  if (holder) parts.push(holder.name);
  parts.push(t('closes_on_day', { day: String(card.closingDay) }), t('due_on_day', { day: String(card.dueDay) }));
  return parts.join(' · ');
}

/** Estimated monthly spend: "~ $ 300.000 + US$ 50", only the non-zero parts. */
function spend(card: CreditCard): string | null {
  const parts = [];
  if (/[1-9]/.test(card.estimatedSpendLocal)) parts.push(formatMoney(card.estimatedSpendLocal, card.localCurrency));
  if (/[1-9]/.test(card.estimatedSpendUsd)) parts.push(formatMoney(card.estimatedSpendUsd, 'USD'));
  return parts.length ? `~ ${parts.join(' + ')}` : null;
}

function CardRow({ card, people }: { card: CreditCard; people: Person[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (input: unknown) => api<CreditCard>('PATCH', `/api/credit-cards/${card.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setEditing(false);
    },
  });
  const estimated = spend(card);

  return (
    <li className={`row${card.active ? '' : ' inactive'}`}>
      <span className="grow">
        <Link to={`/tarjetas/${card.id}`} className="row-link">
          {card.name}
        </Link>
        <span className="note">{describe(card, people)}</span>
        {!card.active && <span className="note">{t('inactive')}</span>}
      </span>
      {estimated && <span className="amount estimate">{estimated}</span>}
      {!editing && (
        <span className="actions">
          <Link to={`/tarjetas/${card.id}`} className="link">
            {t('card_items')}
          </Link>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
          <button type="button" className="link" disabled={update.isPending} onClick={() => update.mutate({ active: !card.active })}>
            {card.active ? t('deactivate') : t('activate')}
          </button>
        </span>
      )}
      {editing && (
        <div className="row-panel">
          <CardForm
            initial={formOf(card)}
            people={people}
            schema={creditCardUpdate}
            pending={update.isPending}
            error={update.error}
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
      {!editing && update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
    </li>
  );
}
