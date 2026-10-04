import { type CardStatement, cardStatementCreate, cardStatementUpdate, type CreditCard, fieldErrors } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { api } from '../api';
import { formatDate, formatDecimal, formatMoney, formatMonth, parseDecimalInput } from '../format';
import { columnLabel, errorMessage, t, tableLabel } from '../glossary';
import { Field } from './Field';
import { StatementBreakdown } from './StatementBreakdown';

const TABLE = 'card_statement';

type FormState = {
  closingDate: string;
  dueDate: string;
  previousBalanceLocal: string;
  previousBalanceUsd: string;
  totalLocal: string;
  totalUsd: string;
  minimumPaymentLocal: string;
};

const emptyForm = (): FormState => ({
  closingDate: '',
  dueDate: '',
  previousBalanceLocal: '0',
  previousBalanceUsd: '0',
  totalLocal: '',
  totalUsd: '0',
  minimumPaymentLocal: '',
});

const formOf = (s: CardStatement): FormState => ({
  closingDate: s.closingDate,
  dueDate: s.dueDate,
  previousBalanceLocal: formatDecimal(s.previousBalanceLocal),
  previousBalanceUsd: formatDecimal(s.previousBalanceUsd),
  totalLocal: formatDecimal(s.totalLocal),
  totalUsd: formatDecimal(s.totalUsd),
  minimumPaymentLocal: formatDecimal(s.minimumPaymentLocal),
});

/** Real statements of a card with their totals (RF-11): each one replaces that month's estimate. */
export function CardStatements({ card }: { card: CreditCard }) {
  const key = ['card-statements', card.id];
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: key, queryFn: () => api<CardStatement[]>('GET', `/api/card-statements?creditCardId=${card.id}`) });
  const [adding, setAdding] = useState(false);
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ['projection'] })]);
  const create = useMutation({
    mutationFn: (input: unknown) => api('POST', '/api/card-statements', input),
    onSuccess: async () => {
      await refresh();
      setAdding(false);
    },
  });

  return (
    <div className="group">
      <div className="page-head">
        <h2>{tableLabel(TABLE, true)}</h2>
        {!adding && (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            {t('add')}
          </button>
        )}
      </div>
      <p className="muted">{t('card_statement_help')}</p>
      {adding && (
        <div className="card">
          <StatementForm
            card={card}
            initial={emptyForm()}
            schema={cardStatementCreate}
            withCard
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
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('empty_list')}</p>
        ) : (
          <ul className="rows">
            {list.data.map((s) => (
              <StatementRow key={s.id} card={card} statement={s} onSaved={refresh} />
            ))}
          </ul>
        ))}
    </div>
  );
}

function StatementForm({ card, initial, schema, withCard, pending, error, onSubmit, onCancel }: {
  card: CreditCard;
  initial: FormState;
  schema: z.ZodType;
  withCard: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      ...(withCard ? { creditCardId: card.id } : {}),
      closingDate: form.closingDate || undefined,
      dueDate: form.dueDate || undefined,
      previousBalanceLocal: parseDecimalInput(form.previousBalanceLocal),
      previousBalanceUsd: parseDecimalInput(form.previousBalanceUsd),
      totalLocal: parseDecimalInput(form.totalLocal),
      totalUsd: parseDecimalInput(form.totalUsd),
      minimumPaymentLocal: parseDecimalInput(form.minimumPaymentLocal),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    onSubmit(parsed.data);
  };

  // the generic labels say "moneda local": show the card's own currency instead
  const local = (c: string) => columnLabel(TABLE, c).replace(t('local_currency_word'), card.localCurrency);
  const money = (field: keyof FormState, label: string) => (
    <Field label={label} error={errors[field]}>
      {(p) => <input {...p} inputMode="decimal" value={form[field]} onChange={set(field)} />}
    </Field>
  );
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={columnLabel(TABLE, 'closing_date')} error={errors.closingDate}>
        {(p) => <input {...p} type="date" value={form.closingDate} onChange={set('closingDate')} />}
      </Field>
      <Field label={columnLabel(TABLE, 'due_date')} error={errors.dueDate}>
        {(p) => <input {...p} type="date" value={form.dueDate} onChange={set('dueDate')} />}
      </Field>
      {money('totalLocal', local('total_local'))}
      {money('totalUsd', columnLabel(TABLE, 'total_usd'))}
      {money('minimumPaymentLocal', `${columnLabel(TABLE, 'minimum_payment_local')} (${card.localCurrency})`)}
      {money('previousBalanceLocal', local('previous_balance_local'))}
      {money('previousBalanceUsd', columnLabel(TABLE, 'previous_balance_usd'))}
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

function StatementRow({ card, statement, onSaved }: { card: CreditCard; statement: CardStatement; onSaved: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [breakdown, setBreakdown] = useState(false);
  const update = useMutation({
    mutationFn: (input: unknown) => api('PATCH', `/api/card-statements/${statement.id}`, input),
    onSuccess: async () => {
      await onSaved();
      setEditing(false);
    },
  });
  const usd = /[1-9]/.test(statement.totalUsd) ? ` + ${formatMoney(statement.totalUsd, 'USD')}` : '';
  return (
    <li className="row">
      <span className="grow">
        {formatMonth(statement.period)}
        <span className="note">
          {t('closed_on', { date: formatDate(statement.closingDate) })} · {t('due_on', { day: formatDate(statement.dueDate) })}
        </span>
      </span>
      <span className="amount">
        {formatMoney(statement.totalLocal, card.localCurrency)}
        {usd}
      </span>
      {!editing && (
        <span className="actions">
          <button type="button" className="link" aria-expanded={breakdown} onClick={() => setBreakdown(!breakdown)}>
            {t('breakdown')}
          </button>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
        </span>
      )}
      {breakdown && !editing && <StatementBreakdown card={card} statement={statement} />}
      {editing && (
        <div className="row-panel">
          <StatementForm
            card={card}
            initial={formOf(statement)}
            schema={cardStatementUpdate}
            withCard={false}
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
    </li>
  );
}
