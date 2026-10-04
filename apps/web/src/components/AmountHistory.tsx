import { type AmountEntry, amountEntryCreate, amountEntryUpdate, fieldErrors } from '@meta31/contracts';
import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { currentPeriodIso, formatDecimal, formatMoney, formatMonth, monthInputToPeriod, parseDecimalInput, periodToMonthInput } from '../format';
import { columnLabel, errorMessage, t, tableLabel } from '../glossary';
import { Field } from './Field';

type Props = {
  /** Resource of the rule, e.g. '/api/income-sources/<id>'; amounts live under '/amounts'. */
  path: string;
  /** History table in the glossary: income_source_amount, recurring_expense_amount. */
  table: string;
  help: string;
  amounts: AmountEntry[];
  currency: string;
  queryKey: QueryKey;
  onClose: () => void;
};

/** Amount history (rule 7, RF-19): each amount applies from its month until the next one. */
export function AmountHistory({ path, table, help, amounts, currency, queryKey, onClose }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ fromPeriod: periodToMonthInput(currentPeriodIso()), amount: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: (input: unknown) => api('POST', `${path}/amounts`, input),
    onSuccess: () => {
      setForm((f) => ({ ...f, amount: '' }));
      return queryClient.invalidateQueries({ queryKey });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.reset();
    const parsed = amountEntryCreate.safeParse({
      fromPeriod: monthInputToPeriod(form.fromPeriod),
      amount: parseDecimalInput(form.amount),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    add.mutate(parsed.data);
  };

  return (
    <div className="row-panel">
      <h2>{tableLabel(table, true)}</h2>
      <p className="muted">{help}</p>
      <ul className="rows nested">
        {[...amounts].reverse().map((a) => (
          <AmountRow key={a.id} path={path} table={table} amount={a} currency={currency} queryKey={queryKey} />
        ))}
      </ul>
      <form className="form-inline" onSubmit={submit} noValidate>
        <Field label={columnLabel(table, 'from_period')} error={errors.fromPeriod}>
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

type RowProps = { path: string; table: string; amount: AmountEntry; currency: string; queryKey: QueryKey };

function AmountRow({ path, table, amount, currency, queryKey }: RowProps) {
  const queryClient = useQueryClient();
  const initial = { fromPeriod: periodToMonthInput(amount.fromPeriod), amount: formatDecimal(amount.amount) };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useMutation({
    mutationFn: (input: unknown) => api('PATCH', `${path}/amounts/${amount.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setEditing(false);
    },
  });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    update.reset();
    const parsed = amountEntryUpdate.safeParse({
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
          <Field label={columnLabel(table, 'from_period')} error={errors.fromPeriod}>
            {(p) => <input {...p} type="month" value={form.fromPeriod} onChange={(e) => setForm({ ...form, fromPeriod: e.target.value })} />}
          </Field>
          <Field label={columnLabel(table, 'amount')} error={errors.amount}>
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
      <span className="amount">{formatMoney(amount.amount, currency)}</span>
      <span className="actions">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          {t('edit')}
        </button>
      </span>
    </li>
  );
}
