import {
  type CommitmentDetail,
  fieldErrors,
  incomeReceive,
  paymentCreate,
  paymentMethod,
  type ProjectionLine,
} from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { formatDate, formatDecimal, formatMoney, parseDecimalInput, sumDecimals, todayIso } from '../format';
import { columnLabel, enumLabel, errorMessage, t } from '../glossary';
import { Field } from './Field';

const PROJECTION_KEY = ['projection'];

/** Currencies a line can be paid in: its own, or the other side of a direct rate (rule 3). */
const payableIn = (currency: string): string[] => (currency === 'USD' ? ['USD', 'ARS', 'UYU'] : [currency, 'USD']);

/** What can be done with a line of the month: pay a commitment (RF-28) or receive an income (RF-08). */
export function LineActions({ line, isIncome, onClose }: { line: ProjectionLine; isIncome: boolean; onClose: () => void }) {
  if (!line.id) {
    // a virtual line: nothing stored to act on until its month is opened (D1)
    return (
      <div className="row-panel">
        <p className="muted">{t('line_not_open')}</p>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
    );
  }
  return isIncome ? <ReceiveIncome line={line} onClose={onClose} /> : <PayCommitment id={line.id} onClose={onClose} />;
}

function PayCommitment({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const key = ['commitment', id];
  const detail = useQuery({ queryKey: key, queryFn: () => api<CommitmentDetail>('GET', `/api/commitments/${id}`) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: PROJECTION_KEY })]);
  const undo = useMutation({
    mutationFn: (paymentId: string) => api('DELETE', `/api/commitments/${id}/payments/${paymentId}`),
    onSuccess: refresh,
  });

  if (detail.isPending) return <div className="row-panel muted">{t('loading')}</div>;
  if (detail.isError) return <div className="row-panel warning">{errorMessage(detail.error)}</div>;
  const d = detail.data;
  const remaining = sumDecimals([d.amountInForce, `-${d.paid}`]);

  return (
    <div className="row-panel">
      {d.payments.length > 0 && (
        <>
          <p className="muted">{t('paid_of', { paid: formatMoney(d.paid, d.currency), total: formatMoney(d.amountInForce, d.currency) })}</p>
          <ul className="rows nested">
            {d.payments.map((p) => (
              <li key={p.id} className="row">
                <span className="grow">
                  {formatDate(p.date)}
                  <span className="note">
                    {enumLabel('payment_method', p.paymentMethod)}
                    {p.appliedRate && ` · ${formatMoney(p.amountPaid, p.paymentCurrency)} a ${formatDecimal(p.appliedRate)}`}
                  </span>
                </span>
                <span className="amount">{formatMoney(p.allocatedAmount, d.currency)}</span>
                <span className="actions">
                  <button type="button" className="link danger" disabled={undo.isPending} onClick={() => undo.mutate(p.id)}>
                    {t('undo')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {undo.isError && <p className="warning">{errorMessage(undo.error)}</p>}
      {d.status !== 'paid' && d.status !== 'cancelled' ? (
        <PaymentForm detail={d} remaining={remaining.startsWith('-') ? '0' : remaining} onPaid={refresh} onClose={onClose} />
      ) : (
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      )}
    </div>
  );
}

function PaymentForm({ detail, remaining, onPaid, onClose }: {
  detail: CommitmentDetail;
  remaining: string;
  onPaid: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    amountPaid: formatDecimal(remaining),
    date: todayIso(),
    paymentCurrency: detail.currency as string,
    appliedRate: '',
    paymentMethod: 'transfer',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pay = useMutation({
    mutationFn: (input: unknown) => api('POST', `/api/commitments/${detail.id}/payments`, input),
    onSuccess: async () => {
      await onPaid();
      onClose();
    },
  });
  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: e.target.value });
  const converting = form.paymentCurrency !== detail.currency;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    pay.reset();
    const parsed = paymentCreate.safeParse({
      date: form.date,
      paymentCurrency: form.paymentCurrency,
      amountPaid: parseDecimalInput(form.amountPaid),
      appliedRate: converting && form.appliedRate.trim() ? parseDecimalInput(form.appliedRate) : null,
      paymentMethod: form.paymentMethod,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    pay.mutate(parsed.data);
  };

  const col = (c: string) => columnLabel('commitment_payment', c);
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('payment_currency')} error={errors.paymentCurrency}>
        {(p) => (
          <select {...p} value={form.paymentCurrency} onChange={set('paymentCurrency')}>
            {payableIn(detail.currency).map((c) => (
              <option key={c} value={c}>
                {enumLabel('currency', c)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('amount_paid')} error={errors.amountPaid}>
        {(p) => <input {...p} inputMode="decimal" value={form.amountPaid} onChange={set('amountPaid')} />}
      </Field>
      {converting && (
        <Field label={col('applied_rate')} error={errors.appliedRate}>
          {(p) => <input {...p} inputMode="decimal" value={form.appliedRate} placeholder={t('rate_of_the_day')} onChange={set('appliedRate')} />}
        </Field>
      )}
      <Field label={col('date')} error={errors.date}>
        {(p) => <input {...p} type="date" value={form.date} onChange={set('date')} />}
      </Field>
      <Field label={col('payment_method')} error={errors.paymentMethod}>
        {(p) => (
          <select {...p} value={form.paymentMethod} onChange={set('paymentMethod')}>
            {paymentMethod.options.map((m) => (
              <option key={m} value={m}>
                {enumLabel('payment_method', m)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {converting && <p className="muted form-error">{t('payment_rate_help')}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={pay.isPending}>
          {pay.isPending ? t('saving') : t('pay')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {pay.isError && <p className="warning form-error">{errorMessage(pay.error)}</p>}
    </form>
  );
}

function ReceiveIncome({ line, onClose }: { line: ProjectionLine; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ actualAmount: formatDecimal(line.amount), receivedDate: todayIso() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = () => queryClient.invalidateQueries({ queryKey: PROJECTION_KEY });
  const receive = useMutation({
    mutationFn: (input: unknown) => api('POST', `/api/incomes/${line.id}/receive`, input),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  const undo = useMutation({ mutationFn: () => api('DELETE', `/api/incomes/${line.id}/receive`), onSuccess: refresh });

  if (line.status === 'received') {
    return (
      <div className="row-panel">
        <div className="form-actions">
          <button type="button" className="link danger" disabled={undo.isPending} onClick={() => undo.mutate()}>
            {t('undo_received')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
        {undo.isError && <p className="warning">{errorMessage(undo.error)}</p>}
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    receive.reset();
    const parsed = incomeReceive.safeParse({ receivedDate: form.receivedDate, actualAmount: parseDecimalInput(form.actualAmount) });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    receive.mutate(parsed.data);
  };

  return (
    <div className="row-panel">
      <form className="form-grid" onSubmit={submit} noValidate>
        <Field label={`${columnLabel('income', 'actual_amount')} (${line.currency})`} error={errors.actualAmount}>
          {(p) => <input {...p} inputMode="decimal" value={form.actualAmount} onChange={(e) => setForm({ ...form, actualAmount: e.target.value })} />}
        </Field>
        <Field label={columnLabel('income', 'received_date')} error={errors.receivedDate}>
          {(p) => <input {...p} type="date" value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} />}
        </Field>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={receive.isPending}>
            {receive.isPending ? t('saving') : t('mark_received')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
        {receive.isError && <p className="warning form-error">{errorMessage(receive.error)}</p>}
      </form>
    </div>
  );
}
