import {
  type Category,
  type CreditCard,
  fieldErrors,
  type InstallmentPurchase,
  installmentPurchaseCreate,
  installmentPurchaseUpdate,
  type Subscription,
  subscriptionCreate,
  subscriptionUpdate,
} from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { z } from 'zod';
import { api } from '../api';
import { CardStatements } from '../components/CardStatements';
import { DeleteButton } from '../components/DeleteButton';
import { Field } from '../components/Field';
import {
  addMonthsToMonthInput,
  currentPeriodIso,
  formatDate,
  formatDecimal,
  formatMoney,
  formatMonth,
  monthInputToPeriod,
  parseDecimalInput,
  periodToMonthInput,
  todayIso,
} from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

/** A card with its installment purchases (RF-13) and subscriptions (RF-14). */
export function CardDetail() {
  const { id = '' } = useParams();
  const cards = useQuery({ queryKey: ['credit-cards'], queryFn: () => api<CreditCard[]>('GET', '/api/credit-cards') });
  const categories = useQuery({
    queryKey: ['categories', 'expense'],
    queryFn: () => api<Category[]>('GET', '/api/categories?kind=expense'),
  });
  const card = cards.data?.find((c) => c.id === id);

  if (cards.isPending) return <p className="muted">{t('loading')}</p>;
  if (cards.isError) return <p className="warning">{errorMessage(cards.error)}</p>;
  if (!card) return <p className="warning">{t('error_not_found')}</p>;

  const ctx: Ctx = { card, categories: categories.data ?? [] };
  return (
    <section className="page">
      <p className="muted">
        <Link to="/tarjetas">{tableLabel('credit_card', true)}</Link>
      </p>
      <h1>{card.name}</h1>
      <CardStatements card={card} />
      <Purchases ctx={ctx} />
      <Subscriptions ctx={ctx} />
    </section>
  );
}

type Ctx = { card: CreditCard; categories: Category[] };

/** Card currencies (D4): its local one and USD. */
const currenciesOf = (card: CreditCard) => [card.localCurrency, 'USD'] as const;

function CategorySelect({ ctx, value, onChange, error, label, currentId }: {
  ctx: Ctx;
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
  label: string;
  currentId?: string | undefined;
}) {
  const options = ctx.categories.filter((c) => (c.active && !c.system) || c.id === currentId);
  return (
    <Field label={label} error={error}>
      {(p) => (
        <select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            —
          </option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function CurrencySelect({ ctx, value, onChange, error, label }: {
  ctx: Ctx;
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
  label: string;
}) {
  return (
    <Field label={label} error={error}>
      {(p) => (
        <select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          {currenciesOf(ctx.card).map((c) => (
            <option key={c} value={c}>
              {enumLabel('currency', c)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function FormButtons({ pending, onCancel, error }: { pending: boolean; onCancel: () => void; error: unknown }) {
  return (
    <>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
      {error ? <p className="warning form-error">{errorMessage(error)}</p> : null}
    </>
  );
}

// ---------- installment purchases ----------

const PURCHASES = 'installment_purchase';

type PurchaseForm = {
  description: string;
  categoryId: string;
  purchaseDate: string;
  currency: string;
  installmentAmount: string;
  installmentsTotal: string;
  currentInstallment: string;
  firstPeriod: string; // 'YYYY-MM'
};

const emptyPurchase = (card: CreditCard): PurchaseForm => ({
  description: '',
  categoryId: '',
  purchaseDate: todayIso(),
  currency: card.localCurrency,
  installmentAmount: '',
  installmentsTotal: '',
  currentInstallment: '',
  firstPeriod: periodToMonthInput(currentPeriodIso()),
});

const purchaseFormOf = (p: InstallmentPurchase): PurchaseForm => ({
  description: p.description,
  categoryId: p.categoryId,
  purchaseDate: p.purchaseDate,
  currency: p.currency,
  installmentAmount: formatDecimal(p.installmentAmount),
  installmentsTotal: String(p.installmentsTotal),
  currentInstallment: p.currentInstallment === null ? '' : String(p.currentInstallment),
  firstPeriod: periodToMonthInput(p.firstPeriod),
});

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

function PurchaseFormView({ ctx, initial, schema, withCard, pending, error, onSubmit, onCancel, currentCategoryId }: {
  ctx: Ctx;
  initial: PurchaseForm;
  schema: z.ZodType;
  withCard: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
  currentCategoryId?: string;
}) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: keyof PurchaseForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });

  // RNF-15: "va por la cuota 4" in this month's statement → installment 1 was three months back
  const setCurrent = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const n = Number(value);
    const firstPeriod =
      Number.isInteger(n) && n >= 1 ? addMonthsToMonthInput(periodToMonthInput(currentPeriodIso()), -(n - 1)) : form.firstPeriod;
    setForm({ ...form, currentInstallment: value, firstPeriod });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      ...(withCard ? { creditCardId: ctx.card.id } : {}),
      description: form.description,
      categoryId: form.categoryId || undefined,
      purchaseDate: form.purchaseDate,
      currency: form.currency,
      installmentAmount: parseDecimalInput(form.installmentAmount),
      installmentsTotal: num(form.installmentsTotal),
      firstPeriod: monthInputToPeriod(form.firstPeriod) || undefined,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    onSubmit(parsed.data);
  };

  const col = (c: string) => columnLabel(PURCHASES, c);
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('description')} error={errors.description}>
        {(p) => <input {...p} value={form.description} onChange={set('description')} />}
      </Field>
      <CategorySelect
        ctx={ctx}
        label={col('category_id')}
        value={form.categoryId}
        onChange={(categoryId) => setForm({ ...form, categoryId })}
        error={errors.categoryId}
        currentId={currentCategoryId}
      />
      <Field label={col('purchase_date')} error={errors.purchaseDate}>
        {(p) => <input {...p} type="date" value={form.purchaseDate} onChange={set('purchaseDate')} />}
      </Field>
      <CurrencySelect ctx={ctx} label={col('currency')} value={form.currency} onChange={(currency) => setForm({ ...form, currency })} error={errors.currency} />
      <Field label={col('installment_amount')} error={errors.installmentAmount}>
        {(p) => <input {...p} inputMode="decimal" value={form.installmentAmount} onChange={set('installmentAmount')} />}
      </Field>
      <Field label={col('installments_total')} error={errors.installmentsTotal}>
        {(p) => <input {...p} inputMode="numeric" value={form.installmentsTotal} onChange={set('installmentsTotal')} />}
      </Field>
      <Field label={t('current_installment')} error={undefined}>
        {(p) => <input {...p} inputMode="numeric" value={form.currentInstallment} onChange={setCurrent} title={t('current_installment_help')} />}
      </Field>
      <Field label={col('first_period')} error={errors.firstPeriod}>
        {(p) => <input {...p} type="month" value={form.firstPeriod} onChange={set('firstPeriod')} />}
      </Field>
      <p className="muted form-error">{t('current_installment_help')}</p>
      <FormButtons pending={pending} onCancel={onCancel} error={error} />
    </form>
  );
}

function Purchases({ ctx }: { ctx: Ctx }) {
  const key = ['installment-purchases', ctx.card.id];
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<InstallmentPurchase[]>('GET', `/api/installment-purchases?creditCardId=${ctx.card.id}`),
  });
  const [adding, setAdding] = useState(false);
  const create = useMutation({
    mutationFn: (input: unknown) => api('POST', '/api/installment-purchases', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      setAdding(false);
    },
  });

  return (
    <div className="group">
      <div className="page-head">
        <h2>{tableLabel(PURCHASES, true)}</h2>
        {!adding && (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            {t('add')}
          </button>
        )}
      </div>
      {adding && (
        <div className="card">
          <PurchaseFormView
            ctx={ctx}
            initial={emptyPurchase(ctx.card)}
            schema={installmentPurchaseCreate}
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
            {list.data.map((p) => (
              <PurchaseRow key={p.id} ctx={ctx} purchase={p} queryKey={key} />
            ))}
          </ul>
        ))}
    </div>
  );
}

/** "cuota 4 de 12 · hasta febrero 2027", "empieza en noviembre 2026" or "terminó en marzo 2026". */
function purchaseNote(p: InstallmentPurchase): string {
  const now = currentPeriodIso();
  if (p.currentInstallment !== null) {
    const parts = [t('installment_n_of', { n: String(p.currentInstallment), total: String(p.installmentsTotal) })];
    if (p.lastPeriod > now) parts.push(t('until_month', { month: formatMonth(p.lastPeriod) }));
    return parts.join(' · ');
  }
  if (p.firstPeriod > now) {
    return `${t('installments_of', { n: String(p.installmentsTotal), amount: formatMoney(p.installmentAmount, p.currency) })} · ${t('starts_in', { month: formatMonth(p.firstPeriod) })}`;
  }
  return t('ended_in', { month: formatMonth(p.lastPeriod) });
}

function PurchaseRow({ ctx, purchase, queryKey }: { ctx: Ctx; purchase: InstallmentPurchase; queryKey: unknown[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (input: unknown) => api('PATCH', `/api/installment-purchases/${purchase.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setEditing(false);
    },
  });
  const ended = purchase.lastPeriod < currentPeriodIso();

  return (
    <li className={`row${ended ? ' inactive' : ''}`}>
      <span className="grow">
        {purchase.description}
        <span className="note">{purchaseNote(purchase)}</span>
      </span>
      <span className="amount">{formatMoney(purchase.installmentAmount, purchase.currency)}</span>
      {!editing && (
        <span className="actions">
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
          <DeleteButton path={`/api/installment-purchases/${purchase.id}`} name={purchase.description} queryKey={queryKey} />
        </span>
      )}
      {editing && (
        <div className="row-panel">
          <PurchaseFormView
            ctx={ctx}
            initial={purchaseFormOf(purchase)}
            schema={installmentPurchaseUpdate}
            withCard={false}
            pending={update.isPending}
            error={update.error}
            currentCategoryId={purchase.categoryId}
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

// ---------- subscriptions ----------

const SUBSCRIPTIONS = 'subscription';

type SubscriptionForm = { description: string; categoryId: string; currency: string; amount: string; validFrom: string; validTo: string };

const emptySubscription = (card: CreditCard): SubscriptionForm => ({
  description: '',
  categoryId: '',
  currency: card.localCurrency,
  amount: '',
  validFrom: todayIso(),
  validTo: '',
});

const subscriptionFormOf = (s: Subscription): SubscriptionForm => ({
  description: s.description,
  categoryId: s.categoryId,
  currency: s.currency,
  amount: formatDecimal(s.amount),
  validFrom: s.validFrom,
  validTo: s.validTo ?? '',
});

function SubscriptionFormView({ ctx, initial, schema, withCard, pending, error, onSubmit, onCancel, currentCategoryId }: {
  ctx: Ctx;
  initial: SubscriptionForm;
  schema: z.ZodType;
  withCard: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
  currentCategoryId?: string;
}) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (field: keyof SubscriptionForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      ...(withCard ? { creditCardId: ctx.card.id } : {}),
      description: form.description,
      categoryId: form.categoryId || undefined,
      currency: form.currency,
      amount: parseDecimalInput(form.amount),
      validFrom: form.validFrom,
      validTo: form.validTo || null,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    onSubmit(parsed.data);
  };

  const col = (c: string) => columnLabel(SUBSCRIPTIONS, c);
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label={col('description')} error={errors.description}>
        {(p) => <input {...p} value={form.description} onChange={set('description')} />}
      </Field>
      <CategorySelect
        ctx={ctx}
        label={col('category_id')}
        value={form.categoryId}
        onChange={(categoryId) => setForm({ ...form, categoryId })}
        error={errors.categoryId}
        currentId={currentCategoryId}
      />
      <CurrencySelect ctx={ctx} label={col('currency')} value={form.currency} onChange={(currency) => setForm({ ...form, currency })} error={errors.currency} />
      <Field label={col('amount')} error={errors.amount}>
        {(p) => <input {...p} inputMode="decimal" value={form.amount} onChange={set('amount')} />}
      </Field>
      <Field label={col('valid_from')} error={errors.validFrom}>
        {(p) => <input {...p} type="date" value={form.validFrom} onChange={set('validFrom')} />}
      </Field>
      <Field label={col('valid_to')} error={errors.validTo}>
        {(p) => <input {...p} type="date" value={form.validTo} onChange={set('validTo')} />}
      </Field>
      <FormButtons pending={pending} onCancel={onCancel} error={error} />
    </form>
  );
}

function Subscriptions({ ctx }: { ctx: Ctx }) {
  const key = ['subscriptions', ctx.card.id];
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<Subscription[]>('GET', `/api/subscriptions?creditCardId=${ctx.card.id}`),
  });
  const [adding, setAdding] = useState(false);
  const create = useMutation({
    mutationFn: (input: unknown) => api('POST', '/api/subscriptions', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      setAdding(false);
    },
  });

  return (
    <div className="group">
      <div className="page-head">
        <h2>{tableLabel(SUBSCRIPTIONS, true)}</h2>
        {!adding && (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            {t('add')}
          </button>
        )}
      </div>
      {adding && (
        <div className="card">
          <SubscriptionFormView
            ctx={ctx}
            initial={emptySubscription(ctx.card)}
            schema={subscriptionCreate}
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
              <SubscriptionRow key={s.id} ctx={ctx} subscription={s} queryKey={key} />
            ))}
          </ul>
        ))}
    </div>
  );
}

function SubscriptionRow({ ctx, subscription, queryKey }: { ctx: Ctx; subscription: Subscription; queryKey: unknown[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (input: unknown) => api('PATCH', `/api/subscriptions/${subscription.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setEditing(false);
    },
  });
  const cancelled = subscription.validTo !== null && subscription.validTo < todayIso();
  const note = subscription.validTo
    ? t('cancelled_on', { date: formatDate(subscription.validTo) })
    : t('since_date', { date: formatDate(subscription.validFrom) });

  return (
    <li className={`row${cancelled ? ' inactive' : ''}`}>
      <span className="grow">
        {subscription.description}
        <span className="note">{note}</span>
      </span>
      <span className="amount">{formatMoney(subscription.amount, subscription.currency)}</span>
      {!editing && (
        <span className="actions">
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {t('edit')}
          </button>
          {!subscription.validTo && (
            <button type="button" className="link" disabled={update.isPending} onClick={() => update.mutate({ validTo: todayIso() })}>
              {t('cancel_subscription')}
            </button>
          )}
          <DeleteButton path={`/api/subscriptions/${subscription.id}`} name={subscription.description} queryKey={queryKey} />
        </span>
      )}
      {!editing && update.isError && <p className="warning form-error">{errorMessage(update.error)}</p>}
      {editing && (
        <div className="row-panel">
          <SubscriptionFormView
            ctx={ctx}
            initial={subscriptionFormOf(subscription)}
            schema={subscriptionUpdate}
            withCard={false}
            pending={update.isPending}
            error={update.error}
            currentCategoryId={subscription.categoryId}
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
