import {
  type ExchangeRate,
  type ExchangeRateCreate,
  exchangeRateCreate,
  exchangeRateUpdate,
  fieldErrors,
} from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Field } from '../components/Field';
import { formatDate, formatDecimal, parseDecimalInput, todayIso } from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

const PAIRS = ['USD_ARS', 'UYU_USD'] as const;
const KEY = ['exchange-rates'];

export function ExchangeRates() {
  const list = useQuery({ queryKey: KEY, queryFn: () => api<ExchangeRate[]>('GET', '/api/exchange-rates') });

  return (
    <section className="page">
      <h1>{tableLabel('exchange_rate', true)}</h1>
      <p className="muted">{t('exchange_rate_help')}</p>
      <CreateRate />
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        PAIRS.map((pair) => {
          const items = list.data.filter((r) => r.pair === pair);
          return (
            <div key={pair} className="group">
              <h2>{enumLabel('currency_pair', pair)}</h2>
              {items.length === 0 ? (
                <p className="muted">{t('empty_list')}</p>
              ) : (
                <ul className="rows">
                  {items.map((r) => (
                    <RateRow key={r.id} rate={r} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}

type FormState = { pair: string; validFrom: string; rate: string };

function CreateRate() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({ pair: 'USD_ARS', validFrom: todayIso(), rate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (input: ExchangeRateCreate) => api<ExchangeRate>('POST', '/api/exchange-rates', input),
    onSuccess: () => {
      setForm((f) => ({ ...f, rate: '' }));
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.reset(); // a new attempt clears the previous server error
    const parsed = exchangeRateCreate.safeParse({ ...form, rate: parseDecimalInput(form.rate) });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <form className="card form-inline" onSubmit={submit} noValidate>
      <Field label={columnLabel('exchange_rate', 'pair')} error={errors.pair}>
        {(p) => (
          <select {...p} value={form.pair} onChange={(e) => setForm({ ...form, pair: e.target.value })}>
            {PAIRS.map((pair) => (
              <option key={pair} value={pair}>
                {enumLabel('currency_pair', pair)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={columnLabel('exchange_rate', 'valid_from')} error={errors.validFrom}>
        {(p) => <input {...p} type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />}
      </Field>
      <Field label={columnLabel('exchange_rate', 'rate')} error={errors.rate}>
        {(p) => (
          <input
            {...p}
            inputMode="decimal"
            autoComplete="off"
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value })}
          />
        )}
      </Field>
      <button type="submit" className="primary" disabled={create.isPending}>
        {create.isPending ? t('saving') : t('add')}
      </button>
      {create.isError && <p className="warning form-error">{errorMessage(create.error)}</p>}
    </form>
  );
}

function RateRow({ rate }: { rate: ExchangeRate }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ validFrom: rate.validFrom, rate: formatDecimal(rate.rate) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useMutation({
    mutationFn: (input: { validFrom?: string; rate?: string }) =>
      api<ExchangeRate>('PATCH', `/api/exchange-rates/${rate.id}`, input),
    onSuccess: () => {
      setEditing(false);
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    update.reset(); // a new attempt clears the previous server error
    const parsed = exchangeRateUpdate.safeParse({ validFrom: form.validFrom, rate: parseDecimalInput(form.rate) });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    update.mutate(parsed.data);
  };

  if (editing) {
    return (
      <li className="row">
        <form className="form-inline grow" onSubmit={save} noValidate>
          <Field label={columnLabel('exchange_rate', 'valid_from')} error={errors.validFrom}>
            {(p) => <input {...p} type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />}
          </Field>
          <Field label={columnLabel('exchange_rate', 'rate')} error={errors.rate}>
            {(p) => <input {...p} inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />}
          </Field>
          <button type="submit" className="primary" disabled={update.isPending}>
            {t('save')}
          </button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            {t('cancel')}
          </button>
          {update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
        </form>
      </li>
    );
  }

  return (
    <li className="row">
      <span className="grow">{formatDate(rate.validFrom)}</span>
      <span className="amount">{formatDecimal(rate.rate)}</span>
      <span className="actions">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          {t('edit')}
        </button>
      </span>
    </li>
  );
}
