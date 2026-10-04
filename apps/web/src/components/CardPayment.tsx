import { type CommitmentDetail, cardPaymentInput, type ExchangeRate, fieldErrors, paymentMethod, type ProjectionLine } from '@meta31/contracts';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { formatDecimal, formatMoney, multiplyDecimals, parseDecimalInput, sumDecimals, todayIso } from '../format';
import { columnLabel, enumLabel, errorMessage, t } from '../glossary';
import { Field } from './Field';

/** What is left of a commitment, never below zero. */
const left = (d: CommitmentDetail) => {
  const r = sumDecimals([d.amountInForce, `-${d.paid}`]);
  return r.startsWith('-') ? '0.00' : r;
};

/**
 * Pay a card statement in its payment currency (RF-15, rule 3): the local part and the USD part
 * in local currency, with the rate (the one in force by default, editable to the bank's).
 */
export function CardPaymentForm({ lines, onPaid, onClose }: { lines: ProjectionLine[]; onPaid: () => Promise<unknown>; onClose: () => void }) {
  const details = useQueries({
    queries: lines.map((l) => ({ queryKey: ['commitment', l.id], queryFn: () => api<CommitmentDetail>('GET', `/api/commitments/${l.id}`) })),
  });
  const rates = useQuery({ queryKey: ['exchange-rates'], queryFn: () => api<ExchangeRate[]>('GET', '/api/exchange-rates') });
  if (details.some((d) => d.isPending) || rates.isPending) return <p className="muted">{t('loading')}</p>;
  const all = details.map((d) => d.data).filter((d): d is CommitmentDetail => Boolean(d));
  const usd = all.find((d) => d.currency === 'USD');
  const local = all.find((d) => d.currency !== 'USD');
  const localCurrency = local?.currency ?? (lines.some((l) => l.currency === 'UYU') ? 'UYU' : 'ARS');
  return <Form local={local} usd={usd} localCurrency={localCurrency} rates={rates.data ?? []} lines={lines} onPaid={onPaid} onClose={onClose} />;
}

function Form({ local, usd, localCurrency, rates, lines, onPaid, onClose }: {
  local: CommitmentDetail | undefined;
  usd: CommitmentDetail | undefined;
  localCurrency: string;
  rates: ExchangeRate[];
  lines: ProjectionLine[];
  onPaid: () => Promise<unknown>;
  onClose: () => void;
}) {
  const pair = localCurrency === 'UYU' ? 'UYU_USD' : 'USD_ARS';
  const date0 = todayIso();
  // the API lists newest first: the first one not after the date is the one in force
  const rateOn = (date: string) => rates.find((r) => r.pair === pair && r.validFrom <= date)?.rate ?? '';
  const [form, setForm] = useState(() => {
    const rate = rateOn(date0);
    return {
      date: date0,
      paymentMethod: 'debit',
      localAmount: local ? formatDecimal(left(local)) : '',
      appliedRate: rate ? formatDecimal(rate) : '',
      usdPartAmount: usd && rate ? formatDecimal(multiplyDecimals(left(usd), rate)) : '',
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pay = useMutation({
    mutationFn: (input: unknown) => api('POST', `/api/credit-cards/${lines[0]!.originId}/payments`, input),
    onSuccess: async () => {
      await onPaid();
      onClose();
    },
  });
  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [field]: e.target.value });
  // a new rate recomputes the USD part in pesos
  const setRate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const appliedRate = e.target.value;
    const rate = parseDecimalInput(appliedRate);
    const usdPartAmount = usd && /^\d+(\.\d+)?$/.test(rate) ? formatDecimal(multiplyDecimals(left(usd), rate)) : form.usdPartAmount;
    setForm({ ...form, appliedRate, usdPartAmount });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    pay.reset();
    const amountOrNull = (v: string) => (v.trim() === '' || /^0+([.,]0+)?$/.test(v.trim()) ? null : parseDecimalInput(v));
    const parsed = cardPaymentInput.safeParse({
      period: lines[0]!.date ? `${lines[0]!.date.slice(0, 7)}-01` : undefined,
      date: form.date,
      paymentMethod: form.paymentMethod,
      localAmount: local ? amountOrNull(form.localAmount) : null,
      usdPartAmount: usd ? amountOrNull(form.usdPartAmount) : null,
      appliedRate: usd && form.appliedRate.trim() ? parseDecimalInput(form.appliedRate) : null,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    pay.mutate(parsed.data);
  };

  const col = (c: string) => columnLabel('commitment_payment', c);
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      {local && (
        <Field label={t('card_local_part', { currency: localCurrency, left: formatMoney(left(local), localCurrency) })} error={errors.localAmount}>
          {(p) => <input {...p} inputMode="decimal" value={form.localAmount} onChange={set('localAmount')} />}
        </Field>
      )}
      {usd && (
        <>
          <Field label={col('applied_rate')} error={errors.appliedRate}>
            {(p) => <input {...p} inputMode="decimal" value={form.appliedRate} placeholder={t('rate_of_the_day')} onChange={setRate} />}
          </Field>
          <Field label={t('card_usd_part', { currency: localCurrency, left: formatMoney(left(usd), 'USD') })} error={errors.usdPartAmount}>
            {(p) => <input {...p} inputMode="decimal" value={form.usdPartAmount} onChange={set('usdPartAmount')} />}
          </Field>
        </>
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
      <p className="muted form-error">{t('card_payment_help')}</p>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={pay.isPending}>
          {pay.isPending ? t('saving') : t('pay_statement')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {pay.isError && <p className="warning form-error">{errorMessage(pay.error)}</p>}
    </form>
  );
}
