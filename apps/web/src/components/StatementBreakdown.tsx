import {
  type CardStatement,
  type CardTransaction,
  cardTransactionCreate,
  cardTransactionKind,
  type Category,
  type CreditCard,
  fieldErrors,
  type InstallmentPurchase,
  type Subscription,
} from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { formatDate, formatMoney, parseDecimalInput, sumDecimals } from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';
import { Field } from './Field';

const TABLE = 'card_transaction';

/**
 * Breakdown of a real statement (RF-12): its lines by kind. Informative: the projection uses the
 * statement totals; the sum here is a check against them. Interest, admin fees and taxes feed
 * the financial cost report.
 */
export function StatementBreakdown({ card, statement }: { card: CreditCard; statement: CardStatement }) {
  const key = ['card-transactions', statement.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<CardTransaction[]>('GET', `/api/card-statements/${statement.id}/transactions`) });
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/api/card-statements/${statement.id}/transactions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const lines = list.data ?? [];
  const sumOf = (currency: string) => sumDecimals(lines.filter((l) => l.currency === currency).map((l) => l.amount));

  return (
    <div className="row-panel">
      <p className="muted">
        {t('breakdown_check', {
          local: formatMoney(sumOf(card.localCurrency), card.localCurrency),
          localTotal: formatMoney(statement.totalLocal, card.localCurrency),
          usd: formatMoney(sumOf('USD'), 'USD'),
          usdTotal: formatMoney(statement.totalUsd, 'USD'),
        })}
      </p>
      {lines.length > 0 && (
        <ul className="rows nested">
          {lines.map((l) => (
            <li key={l.id} className="row">
              <span className="grow">
                {l.description}
                <span className="note">
                  {enumLabel('card_transaction_kind', l.kind)}
                  {l.date && ` · ${formatDate(l.date)}`}
                </span>
              </span>
              <span className="amount">{formatMoney(l.amount, l.currency)}</span>
              <span className="actions">
                <button type="button" className="link danger" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>
                  {t('undo')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <AddLine card={card} statementId={statement.id} onAdded={() => queryClient.invalidateQueries({ queryKey: key })} />
    </div>
  );
}

function AddLine({ card, statementId, onAdded }: { card: CreditCard; statementId: string; onAdded: () => Promise<unknown> }) {
  const categories = useQuery({ queryKey: ['categories', 'expense'], queryFn: () => api<Category[]>('GET', '/api/categories?kind=expense') });
  const purchases = useQuery({
    queryKey: ['installment-purchases', card.id],
    queryFn: () => api<InstallmentPurchase[]>('GET', `/api/installment-purchases?creditCardId=${card.id}`),
  });
  const subscriptions = useQuery({ queryKey: ['subscriptions', card.id], queryFn: () => api<Subscription[]>('GET', `/api/subscriptions?creditCardId=${card.id}`) });
  const empty = { kind: 'interest', date: '', description: '', categoryId: '', currency: card.localCurrency as string, amount: '', installmentPurchaseId: '', installmentNumber: '', subscriptionId: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: (input: unknown) => api('POST', `/api/card-statements/${statementId}/transactions`, input),
    onSuccess: async () => {
      setForm({ ...empty, kind: form.kind });
      await onAdded();
    },
  });
  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [field]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.reset();
    const linksPurchase = form.kind === 'installment' && form.installmentPurchaseId !== '';
    const parsed = cardTransactionCreate.safeParse({
      kind: form.kind,
      date: form.date || null,
      description: form.description,
      categoryId: form.categoryId || null,
      currency: form.currency,
      amount: parseDecimalInput(form.amount),
      installmentPurchaseId: linksPurchase ? form.installmentPurchaseId : null,
      installmentNumber: linksPurchase ? (form.installmentNumber.trim() ? Number(form.installmentNumber) : null) : null,
      subscriptionId: form.kind === 'subscription' && form.subscriptionId ? form.subscriptionId : null,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    add.mutate(parsed.data);
  };

  const col = (c: string) => columnLabel(TABLE, c);
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('kind')} error={errors.kind}>
        {(p) => (
          <select {...p} value={form.kind} onChange={set('kind')}>
            {cardTransactionKind.options.map((k) => (
              <option key={k} value={k}>
                {enumLabel('card_transaction_kind', k)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('description')} error={errors.description}>
        {(p) => <input {...p} value={form.description} onChange={set('description')} />}
      </Field>
      <Field label={col('amount')} error={errors.amount}>
        {(p) => <input {...p} inputMode="decimal" value={form.amount} placeholder={t('negative_for_payments')} onChange={set('amount')} />}
      </Field>
      <Field label={col('currency')} error={errors.currency}>
        {(p) => (
          <select {...p} value={form.currency} onChange={set('currency')}>
            {[card.localCurrency, 'USD'].map((c) => (
              <option key={c} value={c}>
                {enumLabel('currency', c)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={col('date')} error={errors.date}>
        {(p) => <input {...p} type="date" value={form.date} onChange={set('date')} />}
      </Field>
      {(form.kind === 'purchase' || form.kind === 'installment' || form.kind === 'subscription') && (
        <Field label={`${col('category_id')} ${t('optional')}`} error={errors.categoryId}>
          {(p) => (
            <select {...p} value={form.categoryId} onChange={set('categoryId')}>
              <option value="">—</option>
              {(categories.data ?? [])
                .filter((c) => c.active && !c.system)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
      )}
      {form.kind === 'installment' && (
        <>
          <Field label={`${tableLabel('installment_purchase')} ${t('optional')}`} error={errors.installmentPurchaseId}>
            {(p) => (
              <select {...p} value={form.installmentPurchaseId} onChange={set('installmentPurchaseId')}>
                <option value="">—</option>
                {(purchases.data ?? []).map((pu) => (
                  <option key={pu.id} value={pu.id}>
                    {pu.description}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {form.installmentPurchaseId && (
            <Field label={col('installment_number')} error={errors.installmentNumber}>
              {(p) => <input {...p} inputMode="numeric" value={form.installmentNumber} onChange={set('installmentNumber')} />}
            </Field>
          )}
        </>
      )}
      {form.kind === 'subscription' && (
        <Field label={`${tableLabel('subscription')} ${t('optional')}`} error={errors.subscriptionId}>
          {(p) => (
            <select {...p} value={form.subscriptionId} onChange={set('subscriptionId')}>
              <option value="">—</option>
              {(subscriptions.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.description}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={add.isPending}>
          {add.isPending ? t('saving') : t('add')}
        </button>
      </div>
      {add.isError && <p className="warning form-error">{errorMessage(add.error)}</p>}
    </form>
  );
}
