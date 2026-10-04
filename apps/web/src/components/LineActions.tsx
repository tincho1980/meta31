import {
  actualAmountInput,
  cancelInput,
  type CommitmentDetail,
  fieldErrors,
  incomeReceive,
  paymentCreate,
  paymentMethod,
  postponeInput,
  type ProjectionLine,
} from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { formatDate, formatDecimal, formatMoney, nextMonthSameDay, parseDecimalInput, sumDecimals, todayIso } from '../format';
import { columnLabel, enumLabel, errorMessage, t } from '../glossary';
import { CardPaymentForm } from './CardPayment';
import { Field } from './Field';

const PROJECTION_KEY = ['projection'];

/** Currencies a line can be paid in: its own, or the other side of a direct rate (rule 3). */
const payableIn = (currency: string): string[] => (currency === 'USD' ? ['USD', 'ARS', 'UYU'] : [currency, 'USD']);

/** What can be done with a line of the month: pay a commitment (RF-28) or receive an income (RF-08). */
export function LineActions({ line, isIncome, onClose, cardLines }: {
  line: ProjectionLine;
  isIncome: boolean;
  onClose: () => void;
  /** For a card statement line: the month's two lines of that card (D4), to pay them together. */
  cardLines?: ProjectionLine[];
}) {
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
  return isIncome ? <ReceiveIncome line={line} onClose={onClose} /> : <PayCommitment id={line.id} onClose={onClose} cardLines={cardLines} />;
}

type Mode = 'pay' | 'actual' | 'postpone' | 'cancel';
const MODE_LABEL: Record<Mode, string> = { pay: 'pay', actual: 'actual_amount', postpone: 'postpone', cancel: 'cancel_commitment' };

function PayCommitment({ id, onClose, cardLines }: { id: string; onClose: () => void; cardLines?: ProjectionLine[] | undefined }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('pay');
  const key = ['commitment', id];
  const detail = useQuery({ queryKey: key, queryFn: () => api<CommitmentDetail>('GET', `/api/commitments/${id}`) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: PROJECTION_KEY })]);
  const undo = useMutation({
    mutationFn: (paymentId: string) => api('DELETE', `/api/commitments/${id}/payments/${paymentId}`),
    onSuccess: refresh,
  });
  // rule 4: the unpaid rest of a card statement goes to the next statement
  const carry = useMutation({
    mutationFn: (dueDate: string) => api('POST', `/api/commitments/${id}/postpone`, { dueDate }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
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
      {d.deviation && (
        <p className="muted">
          {t('deviation_line', {
            amount: `${d.deviation.amount.startsWith('-') ? '' : '+'}${formatMoney(d.deviation.amount, d.currency)}`,
            percent: d.deviation.percent.replace('.', ','),
          })}
        </p>
      )}
      {d.origin === 'credit_card' && d.status === 'partially_paid' && d.dueDate && (
        <div className="form-actions">
          <button type="button" className="secondary" disabled={carry.isPending} onClick={() => carry.mutate(nextMonthSameDay(d.dueDate!))}>
            {t('carry_to_next_statement')}
          </button>
        </div>
      )}
      {carry.isError && <p className="warning">{errorMessage(carry.error)}</p>}
      {d.status === 'paid' && mode !== 'actual' && (
        <div className="form-actions">
          <button type="button" className="link" onClick={() => setMode('actual')}>
            {t('actual_amount')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      )}
      {d.status === 'paid' && mode === 'actual' && <ActualForm detail={d} onDone={refresh} onClose={onClose} />}
      {d.status !== 'paid' && d.status !== 'cancelled' ? (
        <>
          <div className="segmented panel-modes" role="group">
            {(['pay', 'actual', 'postpone', 'cancel'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {t(MODE_LABEL[m])}
              </button>
            ))}
          </div>
          {mode === 'pay' &&
            (d.origin === 'credit_card' && cardLines && cardLines.length > 0 ? (
              <CardPaymentForm lines={cardLines} onPaid={refresh} onClose={onClose} />
            ) : (
              <PaymentForm detail={d} remaining={remaining.startsWith('-') ? '0' : remaining} onPaid={refresh} onClose={onClose} />
            ))}
          {mode === 'postpone' && <PostponeForm detail={d} onDone={refresh} onClose={onClose} />}
          {mode === 'actual' && <ActualForm detail={d} onDone={refresh} onClose={onClose} />}
          {mode === 'cancel' && <CancelForm detail={d} onDone={refresh} onClose={onClose} />}
        </>
      ) : d.status === 'cancelled' ? (
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Postpone to a date (D5): "lo pasaste al 15". With part of it paid, the rest goes to that
 * date as a new line and this one stays paid by what was paid.
 */
function PostponeForm({ detail, onDone, onClose }: { detail: CommitmentDetail; onDone: () => Promise<unknown>; onClose: () => void }) {
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | undefined>();
  const postpone = useMutation({
    mutationFn: (input: unknown) => api('POST', `/api/commitments/${detail.id}/postpone`, input),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    postpone.reset();
    const parsed = postponeInput.safeParse({ dueDate: dueDate || undefined });
    if (!parsed.success) return setError(fieldErrors(parsed.error).dueDate);
    setError(undefined);
    postpone.mutate(parsed.data);
  };
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={t('postpone_to')} error={error}>
        {(p) => <input {...p} type="date" value={dueDate} min={detail.period} onChange={(e) => setDueDate(e.target.value)} />}
      </Field>
      {detail.status === 'partially_paid' && <p className="muted form-error">{t('postpone_rest_help')}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={postpone.isPending}>
          {postpone.isPending ? t('saving') : t('postpone')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {postpone.isError && <p className="warning form-error">{errorMessage(postpone.error)}</p>}
    </form>
  );
}

/**
 * Real amount (rule 10): the bill, statement or bank notice replaces the estimate. A recurring
 * expense can keep it as the estimate from the next month on (RF-19).
 */
function ActualForm({ detail, onDone, onClose }: { detail: CommitmentDetail; onDone: () => Promise<unknown>; onClose: () => void }) {
  const [amount, setAmount] = useState(formatDecimal(detail.actualAmount ?? detail.estimatedAmount));
  const [updateFollowing, setUpdateFollowing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (input: unknown) => api('PUT', `/api/commitments/${detail.id}/actual`, input),
    onSuccess: onDone,
  });
  const clear = useMutation({ mutationFn: () => api('DELETE', `/api/commitments/${detail.id}/actual`), onSuccess: onDone });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.reset();
    const parsed = actualAmountInput.safeParse({ actualAmount: parseDecimalInput(amount), updateFollowing });
    if (!parsed.success) return setError(fieldErrors(parsed.error).actualAmount);
    setError(undefined);
    save.mutate(parsed.data);
  };
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={`${columnLabel('commitment', 'actual_amount')} (${detail.currency})`} error={error}>
        {(p) => <input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <p className="muted form-error">{t('estimated_was', { amount: formatMoney(detail.estimatedAmount, detail.currency) })}</p>
      {detail.origin === 'recurring_expense' && (
        <label className="check form-error">
          <input type="checkbox" checked={updateFollowing} onChange={(e) => setUpdateFollowing(e.target.checked)} />
          {t('update_following')}
        </label>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? t('saving') : t('save')}
        </button>
        {detail.actualAmount !== null && (
          <button type="button" className="secondary" disabled={clear.isPending} onClick={() => clear.mutate()}>
            {t('back_to_estimate')}
          </button>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {(save.isError || clear.isError) && <p className="warning form-error">{errorMessage(save.error ?? clear.error)}</p>}
    </form>
  );
}

/** Cancel with a reason (RF-28): it stops counting; it can be restored from the month's cancelled list. */
function CancelForm({ detail, onDone, onClose }: { detail: CommitmentDetail; onDone: () => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cancel = useMutation({
    mutationFn: (input: unknown) => api('POST', `/api/commitments/${detail.id}/cancel`, input),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    cancel.reset();
    const parsed = cancelInput.safeParse({ reason });
    if (!parsed.success) return setError(fieldErrors(parsed.error).reason);
    setError(undefined);
    cancel.mutate(parsed.data);
  };
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={columnLabel('commitment', 'cancellation_reason')} error={error}>
        {(p) => <input {...p} value={reason} placeholder={t('cancel_reason_example')} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {detail.origin === 'recurring_expense' && (
        <div className="form-error">
          <button type="button" className="secondary" onClick={() => setReason(t('paid_by_card_reason'))}>
            {t('paid_by_card')}
          </button>
          <p className="muted">{t('paid_by_card_help')}</p>
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={cancel.isPending}>
          {cancel.isPending ? t('saving') : t('cancel_commitment')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {cancel.isError && <p className="warning form-error">{errorMessage(cancel.error)}</p>}
    </form>
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
  const cancel = useMutation({
    mutationFn: () => api('POST', `/api/incomes/${line.id}/cancel`, {}),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

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
          <button type="button" className="link danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('income_not_this_month')}
          </button>
        </div>
        {receive.isError && <p className="warning form-error">{errorMessage(receive.error)}</p>}
        {cancel.isError && <p className="warning form-error">{errorMessage(cancel.error)}</p>}
      </form>
    </div>
  );
}
