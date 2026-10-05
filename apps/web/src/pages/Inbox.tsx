import {
  type CreditCard,
  type DocumentOperation,
  documentOperation,
  fieldErrors,
  type Loan,
  OPERATIONS_BY_KIND,
  operationPayloads,
  paymentMethod,
  type RecurringExpense,
  type SourceDocument,
} from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Field } from '../components/Field';
import { CURRENCIES } from '../components/rules';
import { formatDate, formatDecimal, formatMoney, formatMonth, monthInputToPeriod, parseDecimalInput, periodToMonthInput } from '../format';
import { columnLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';

export const DOCUMENTS_KEY = ['documents'] as const;

type Filter = 'inbox' | 'confirmed' | 'discarded';
const FILTERS: Filter[] = ['inbox', 'confirmed', 'discarded'];
const FILTER_LABEL: Record<Filter, string> = { inbox: 'inbox_pending', confirmed: 'inbox_confirmed', discarded: 'inbox_discarded' };

/** Cards, recurring expenses and loans: to name what a document points to and to pick it when correcting. */
function useEntities() {
  const cards = useQuery({ queryKey: ['credit-cards'], queryFn: () => api<CreditCard[]>('GET', '/api/credit-cards') });
  const expenses = useQuery({ queryKey: ['recurring-expenses'], queryFn: () => api<RecurringExpense[]>('GET', '/api/recurring-expenses') });
  const loans = useQuery({ queryKey: ['loans'], queryFn: () => api<Loan[]>('GET', '/api/loans') });
  return { cards: cards.data ?? [], expenses: expenses.data ?? [], loans: loans.data ?? [] };
}
type Entities = ReturnType<typeof useEntities>;

/**
 * Bandeja (RF-35, D3, rule 12): what Claude read from each document waits here until a user
 * confirms it, corrects it or discards it. Nothing reaches the month before that.
 */
export function Inbox() {
  const [filter, setFilter] = useState<Filter>('inbox');
  const list = useQuery({ queryKey: [...DOCUMENTS_KEY, filter], queryFn: () => api<SourceDocument[]>('GET', `/api/documents?status=${filter}`) });
  const entities = useEntities();
  return (
    <section className="page">
      <div className="page-head">
        <h1>{t('nav_inbox')}</h1>
      </div>
      <p className="muted">{t('inbox_help')}</p>
      <div className="segmented" role="group" aria-label={t('filter')}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {t(FILTER_LABEL[f])}
          </button>
        ))}
      </div>
      {list.isPending && <p className="muted">{t('loading')}</p>}
      {list.isError && <p className="warning">{errorMessage(list.error)}</p>}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t(filter === 'inbox' ? 'inbox_empty' : 'empty_list')}</p>
        ) : (
          <ul className="rows inbox">
            {list.data.map((d) => (
              <DocumentRow key={d.id} doc={d} entities={entities} />
            ))}
          </ul>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Reading a payload

type Payload = Record<string, unknown>;
const get = (p: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Payload)[k] : undefined), p);
const str = (p: unknown, path: string) => {
  const v = get(p, path);
  return typeof v === 'string' ? v : '';
};

const cardName = (e: Entities, id: string) => e.cards.find((c) => c.id === id)?.name ?? t('inbox_unknown_entity');
const expenseName = (e: Entities, id: string) => e.expenses.find((x) => x.id === id)?.name ?? t('inbox_unknown_entity');
const lenderName = (e: Entities, id: string) => e.loans.find((l) => l.id === id)?.lender ?? t('inbox_unknown_entity');

/** One line saying what confirming the document would do, in the words of the house. */
function describe(doc: SourceDocument, e: Entities): { title: string; detail: string; amount?: string } {
  const p = doc.payload;
  switch (doc.operation) {
    case 'load_card_statement': {
      const card = e.cards.find((c) => c.id === str(p, 'statement.creditCardId'));
      const local = card?.localCurrency ?? 'ARS';
      const lines = (get(p, 'transactions') as unknown[] | undefined)?.length ?? 0;
      const fresh = ((get(p, 'newInstallmentPurchases') as unknown[] | undefined)?.length ?? 0) + ((get(p, 'newSubscriptions') as unknown[] | undefined)?.length ?? 0);
      const usd = str(p, 'statement.totalUsd');
      return {
        title: `${tableLabel('card_statement')} · ${cardName(e, str(p, 'statement.creditCardId'))}`,
        detail: [t('inbox_due_on', { date: formatDate(str(p, 'statement.dueDate')) }), lines ? t('inbox_lines', { n: String(lines) }) : '', fresh ? t('inbox_new_items', { n: String(fresh) }) : ''].filter(Boolean).join(' · '),
        amount: [formatMoney(str(p, 'statement.totalLocal'), local), usd && /[1-9]/.test(usd) ? formatMoney(usd, 'USD') : ''].filter(Boolean).join(' + '),
      };
    }
    case 'record_utility_bill':
    case 'record_tax':
    case 'record_condo_fee': {
      const x = e.expenses.find((r) => r.id === str(p, 'recurringExpenseId'));
      return {
        title: expenseName(e, str(p, 'recurringExpenseId')),
        detail: `${formatMonth(str(p, 'period'))} · ${columnLabel('commitment', 'actual_amount')}`,
        amount: formatMoney(str(p, 'actualAmount'), x?.currency ?? 'ARS'),
      };
    }
    case 'record_loan_installment': {
      const l = e.loans.find((r) => r.id === str(p, 'loanId'));
      return {
        title: `${tableLabel('loan')} · ${lenderName(e, str(p, 'loanId'))}`,
        detail: `${formatMonth(str(p, 'period'))} · ${columnLabel('commitment', 'actual_amount')}`,
        amount: formatMoney(str(p, 'actualAmount'), l?.currency ?? 'ARS'),
      };
    }
    case 'register_payment': {
      const target = str(p, 'loanId') ? lenderName(e, str(p, 'loanId')) : expenseName(e, str(p, 'recurringExpenseId'));
      return {
        title: `${tableLabel('commitment_payment')} · ${target}`,
        detail: `${formatMonth(str(p, 'period'))} · ${t('inbox_paid_on', { date: formatDate(str(p, 'payment.date')) })}`,
        amount: formatMoney(str(p, 'payment.amountPaid'), str(p, 'payment.paymentCurrency') || 'ARS'),
      };
    }
    case 'register_card_payment': {
      const card = e.cards.find((c) => c.id === str(p, 'creditCardId'));
      const local = card?.localCurrency ?? 'ARS';
      const parts = [str(p, 'payment.localAmount'), str(p, 'payment.usdPartAmount')].filter((v) => v && /[1-9]/.test(v));
      return {
        title: `${t('pay_statement')} · ${cardName(e, str(p, 'creditCardId'))}`,
        detail: `${formatMonth(str(p, 'payment.period'))} · ${t('inbox_paid_on', { date: formatDate(str(p, 'payment.date')) })}`,
        amount: parts.map((v) => formatMoney(v, local)).join(' + '),
      };
    }
    default:
      return { title: enumLabel('document_kind', doc.kind), detail: doc.reason ?? '' };
  }
}

// ---------------------------------------------------------------------------------------------
// One document

function DocumentRow({ doc, entities }: { doc: SourceDocument; entities: Entities }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'none' | 'review' | 'discard'>('none');
  const pending = doc.status === 'pending_review' || doc.status === 'unrecognized';
  const d = describe(doc, entities);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
      // a confirmed document changes the month, the statements and the reports
      queryClient.invalidateQueries({ queryKey: ['projection'] }),
      queryClient.invalidateQueries({ queryKey: ['card-statements'] }),
      queryClient.invalidateQueries({ queryKey: ['commitment'] }),
    ]);
  const confirm = useMutation({ mutationFn: () => api('POST', `/api/documents/${doc.id}/confirm`), onSuccess: refresh });

  return (
    <li className="row">
      <span className="grow">
        <span className="etiqueta">
          {enumLabel('document_kind', doc.kind)} · {enumLabel('document_status', doc.status)}
        </span>
        <span className="row-link">{d.title}</span>
        <span className="note">{d.detail}</span>
        <span className="note">
          {doc.fileName} · {t('inbox_uploaded_by', { name: doc.uploadedBy.name, date: formatDate(doc.createdAt.slice(0, 10)) })}
          {doc.reviewedBy && doc.reviewedAt && ` · ${t('inbox_reviewed_by', { name: doc.reviewedBy.name, date: formatDate(doc.reviewedAt.slice(0, 10)) })}`}
        </span>
        {doc.reason && doc.operation && <span className="note">{doc.reason}</span>}
      </span>
      {d.amount && <span className="amount">{d.amount}</span>}
      {pending && mode === 'none' && (
        <span className="actions">
          {doc.status === 'pending_review' && (
            <button type="button" className="primary" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {confirm.isPending ? t('saving') : t('inbox_confirm')}
            </button>
          )}
          <button type="button" className="link" onClick={() => setMode('review')}>
            {t(doc.status === 'unrecognized' ? 'inbox_complete' : 'inbox_correct')}
          </button>
          <button type="button" className="link" onClick={() => setMode('discard')}>
            {t('inbox_discard')}
          </button>
        </span>
      )}
      {confirm.isError && <p className="warning form-error">{errorMessage(confirm.error)}</p>}
      {mode === 'review' && (
        <div className="row-panel">
          <CorrectForm doc={doc} entities={entities} onDone={refresh} onClose={() => setMode('none')} />
        </div>
      )}
      {mode === 'discard' && (
        <div className="row-panel">
          <DiscardForm doc={doc} onDone={refresh} onClose={() => setMode('none')} />
        </div>
      )}
    </li>
  );
}

function DiscardForm({ doc, onDone, onClose }: { doc: SourceDocument; onDone: () => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const discard = useMutation({
    mutationFn: () => api('POST', `/api/documents/${doc.id}/discard`, { reason: reason.trim() || null }),
    onSuccess: onDone,
  });
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        discard.mutate();
      }}
      noValidate
    >
      <Field label={columnLabel('source_document', 'reason')}>
        {(p) => <input {...p} value={reason} placeholder={t('inbox_discard_example')} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <p className="muted form-error">{t('inbox_discard_help')}</p>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={discard.isPending}>
          {t('inbox_discard')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {discard.isError && <p className="warning form-error">{errorMessage(discard.error)}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Correcting: a form per operation, over the same input the API checks

type FieldKind = 'card' | 'expense' | 'loan' | 'target' | 'month' | 'date' | 'amount' | 'rate' | 'currency' | 'method' | 'check';
type FieldDef = { path: string; kind: FieldKind; label: string; optional?: boolean };

const BILL_CLASSES: Partial<Record<DocumentOperation, readonly string[]>> = {
  record_utility_bill: ['utility', 'recurring', 'budget'],
  record_tax: ['tax'],
  record_condo_fee: ['condo_fee'],
};

const st = (c: string) => columnLabel('card_statement', c);
const pay = (c: string) => columnLabel('commitment_payment', c);
const bill = (): FieldDef[] => [
  { path: 'recurringExpenseId', kind: 'expense', label: tableLabel('recurring_expense') },
  { path: 'period', kind: 'month', label: columnLabel('commitment', 'origin_period') },
  { path: 'actualAmount', kind: 'amount', label: columnLabel('commitment', 'actual_amount') },
  { path: 'updateFollowing', kind: 'check', label: t('update_following') },
];

function fieldsOf(op: DocumentOperation): FieldDef[] {
  switch (op) {
    case 'load_card_statement':
      return [
        { path: 'statement.creditCardId', kind: 'card', label: tableLabel('credit_card') },
        { path: 'statement.closingDate', kind: 'date', label: st('closing_date') },
        { path: 'statement.dueDate', kind: 'date', label: st('due_date') },
        { path: 'statement.totalLocal', kind: 'amount', label: st('total_local') },
        { path: 'statement.totalUsd', kind: 'amount', label: st('total_usd') },
        { path: 'statement.previousBalanceLocal', kind: 'amount', label: st('previous_balance_local') },
        { path: 'statement.previousBalanceUsd', kind: 'amount', label: st('previous_balance_usd') },
        { path: 'statement.minimumPaymentLocal', kind: 'amount', label: st('minimum_payment_local') },
      ];
    case 'record_utility_bill':
    case 'record_tax':
    case 'record_condo_fee':
      return bill();
    case 'record_loan_installment':
      return [
        { path: 'loanId', kind: 'loan', label: tableLabel('loan') },
        { path: 'period', kind: 'month', label: columnLabel('commitment', 'period') },
        { path: 'actualAmount', kind: 'amount', label: columnLabel('commitment', 'actual_amount') },
      ];
    case 'register_payment':
      return [
        { path: 'target', kind: 'target', label: tableLabel('commitment') },
        { path: 'period', kind: 'month', label: columnLabel('commitment', 'origin_period') },
        { path: 'payment.date', kind: 'date', label: pay('date') },
        { path: 'payment.paymentCurrency', kind: 'currency', label: pay('payment_currency') },
        { path: 'payment.amountPaid', kind: 'amount', label: pay('amount_paid') },
        { path: 'payment.appliedRate', kind: 'rate', label: pay('applied_rate'), optional: true },
        { path: 'payment.paymentMethod', kind: 'method', label: pay('payment_method') },
      ];
    case 'register_card_payment':
      return [
        { path: 'creditCardId', kind: 'card', label: tableLabel('credit_card') },
        { path: 'payment.period', kind: 'month', label: columnLabel('commitment', 'period') },
        { path: 'payment.date', kind: 'date', label: pay('date') },
        { path: 'payment.localAmount', kind: 'amount', label: t('inbox_local_part'), optional: true },
        { path: 'payment.usdPartAmount', kind: 'amount', label: t('inbox_usd_part'), optional: true },
        { path: 'payment.appliedRate', kind: 'rate', label: pay('applied_rate'), optional: true },
        { path: 'payment.paymentMethod', kind: 'method', label: pay('payment_method') },
      ];
  }
}

type FormValues = Record<string, string>;

/** Form values (what the inputs show) from a payload. */
function valuesOf(op: DocumentOperation, payload: unknown): FormValues {
  const values: FormValues = {};
  for (const f of fieldsOf(op)) {
    if (f.kind === 'target') {
      const loanId = str(payload, 'loanId');
      const expenseId = str(payload, 'recurringExpenseId');
      values.target = loanId ? `loan:${loanId}` : expenseId ? `expense:${expenseId}` : '';
      continue;
    }
    const v = get(payload, f.path);
    if (f.kind === 'check') values[f.path] = v === true ? 'true' : '';
    else if (f.kind === 'month') values[f.path] = periodToMonthInput(typeof v === 'string' ? v : null);
    else if ((f.kind === 'amount' || f.kind === 'rate') && typeof v === 'string' && v) values[f.path] = formatDecimal(v);
    else values[f.path] = typeof v === 'string' ? v : '';
  }
  return values;
}

function setPath(target: Payload, path: string, value: unknown) {
  const keys = path.split('.');
  let o = target;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Payload;
  o[keys.at(-1)!] = value;
}

/** The payload from the form values; the transactions of a statement are kept as they came. */
function payloadOf(op: DocumentOperation, values: FormValues, original: unknown): Payload {
  const payload: Payload = {};
  for (const f of fieldsOf(op)) {
    const v = values[f.path] ?? '';
    if (f.kind === 'target') {
      const [kind, id] = v.split(':');
      payload.recurringExpenseId = kind === 'expense' ? id : null;
      payload.loanId = kind === 'loan' ? id : null;
    } else if (f.kind === 'check') setPath(payload, f.path, v === 'true');
    else if (f.kind === 'month') setPath(payload, f.path, monthInputToPeriod(v));
    else if (f.kind === 'amount' || f.kind === 'rate') setPath(payload, f.path, v.trim() ? parseDecimalInput(v) : f.optional ? null : '');
    else setPath(payload, f.path, v);
  }
  if (op === 'load_card_statement') {
    payload.transactions = get(original, 'transactions') ?? [];
    payload.newInstallmentPurchases = get(original, 'newInstallmentPurchases') ?? [];
    payload.newSubscriptions = get(original, 'newSubscriptions') ?? [];
  }
  return payload;
}

function CorrectForm({ doc, entities, onDone, onClose }: { doc: SourceDocument; entities: Entities; onDone: () => Promise<unknown>; onClose: () => void }) {
  const choices = doc.kind === 'other' ? documentOperation.options : OPERATIONS_BY_KIND[doc.kind];
  const [op, setOp] = useState<DocumentOperation | ''>(doc.operation ?? (choices.length === 1 ? choices[0]! : ''));
  const [values, setValues] = useState<FormValues>(() => (op ? valuesOf(op, doc.payload) : {}));
  const [lines, setLines] = useState<unknown[]>(() => (get(doc.payload, 'transactions') as unknown[] | undefined) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async ({ input, andConfirm }: { input: unknown; andConfirm: boolean }) => {
      await api('PUT', `/api/documents/${doc.id}`, input);
      if (andConfirm) await api('POST', `/api/documents/${doc.id}/confirm`);
    },
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });

  const submit = (andConfirm: boolean) => {
    if (!op) return;
    save.reset();
    // a new item no line points to any more is dropped with its last line
    const used = (key: string) => new Set(lines.map((l) => str(l, key)).filter(Boolean));
    const purchases = (get(doc.payload, 'newInstallmentPurchases') as unknown[] | undefined)?.filter((n) => used('installmentPurchaseRef').has(str(n, 'ref'))) ?? [];
    const subscriptions = (get(doc.payload, 'newSubscriptions') as unknown[] | undefined)?.filter((n) => used('subscriptionRef').has(str(n, 'ref'))) ?? [];
    const payload = payloadOf(op, values, { transactions: lines, newInstallmentPurchases: purchases, newSubscriptions: subscriptions });
    const parsed = operationPayloads[op].safeParse(payload);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    save.mutate({ input: { operation: op, payload }, andConfirm });
  };

  const set = (path: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues({ ...values, [path]: e.target instanceof HTMLInputElement && e.target.type === 'checkbox' ? (e.target.checked ? 'true' : '') : e.target.value });

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
      noValidate
    >
      {(doc.operation === null || choices.length > 1) && (
        <Field label={columnLabel('source_document', 'operation')}>
          {(p) => (
            <select
              {...p}
              value={op}
              onChange={(e) => {
                const next = e.target.value as DocumentOperation;
                setOp(next);
                setValues(valuesOf(next, doc.operation === next ? doc.payload : {}));
              }}
            >
              <option value="">—</option>
              {choices.map((o) => (
                <option key={o} value={o}>
                  {t(`operation_${o}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {op &&
        fieldsOf(op).map((f) => (
          <FieldInput key={f.path} def={f} op={op} value={values[f.path] ?? ''} error={errors[f.kind === 'target' ? 'recurringExpenseId' : f.path]} onChange={set(f.path)} entities={entities} />
        ))}
      {op === 'load_card_statement' && <NewItems payload={doc.payload} lines={lines} />}
      {op === 'load_card_statement' && lines.length > 0 && <StatementLines lines={lines} onRemove={(i) => setLines(lines.filter((_, j) => j !== i))} />}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={!op || save.isPending}>
          {save.isPending ? t('saving') : t('inbox_save_and_confirm')}
        </button>
        <button type="button" className="secondary" disabled={!op || save.isPending} onClick={() => submit(false)}>
          {t('save')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {save.isError && <p className="warning form-error">{errorMessage(save.error)}</p>}
    </form>
  );
}

function FieldInput({ def, op, value, error, onChange, entities }: {
  def: FieldDef;
  op: DocumentOperation;
  value: string;
  error: string | undefined;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  entities: Entities;
}) {
  if (def.kind === 'check')
    return (
      <label className="check form-error">
        <input type="checkbox" checked={value === 'true'} onChange={onChange} />
        {def.label}
      </label>
    );
  const options = (() => {
    switch (def.kind) {
      case 'card':
        return entities.cards.map((c) => ({ value: c.id, label: c.name }));
      case 'expense':
        return entities.expenses.filter((x) => BILL_CLASSES[op]?.includes(x.class) ?? true).map((x) => ({ value: x.id, label: x.name }));
      case 'loan':
        return entities.loans.map((l) => ({ value: l.id, label: l.lender }));
      case 'target':
        return [
          ...entities.expenses.map((x) => ({ value: `expense:${x.id}`, label: x.name })),
          ...entities.loans.map((l) => ({ value: `loan:${l.id}`, label: `${tableLabel('loan')} · ${l.lender}` })),
        ];
      case 'currency':
        return CURRENCIES.map((c) => ({ value: c, label: c }));
      case 'method':
        return paymentMethod.options.map((m) => ({ value: m, label: enumLabel('payment_method', m) }));
      default:
        return null;
    }
  })();
  return (
    <Field label={def.label} error={error}>
      {(p) =>
        options ? (
          <select {...p} value={value} onChange={onChange}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : def.kind === 'month' ? (
          <input {...p} type="month" value={value} onChange={onChange} />
        ) : def.kind === 'date' ? (
          <input {...p} type="date" value={value} onChange={onChange} />
        ) : (
          <input {...p} inputMode="decimal" value={value} onChange={onChange} />
        )
      }
    </Field>
  );
}

/** The breakdown Claude read from a statement: lines can be dropped here and fixed after confirming. */
function StatementLines({ lines, onRemove }: { lines: unknown[]; onRemove: (i: number) => void }) {
  return (
    <div className="table-wrap form-error">
      <p className="muted">{t('inbox_breakdown', { n: String(lines.length) })}</p>
      <table className="table">
        <thead>
          <tr>
            <th>{columnLabel('card_transaction', 'description')}</th>
            <th>{columnLabel('card_transaction', 'kind')}</th>
            <th>{columnLabel('card_transaction', 'amount')}</th>
            <th>
              <span className="sr-only">{t('delete')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                {str(l, 'description')}
                {get(l, 'installmentNumber') ? ` (${String(get(l, 'installmentNumber'))})` : ''}
                {(str(l, 'installmentPurchaseRef') || str(l, 'subscriptionRef')) && <span className="note"> · {t('inbox_new_tag')}</span>}
              </td>
              <td>{enumLabel('card_transaction_kind', str(l, 'kind'))}</td>
              <td>{formatMoney(str(l, 'amount'), str(l, 'currency') || 'ARS')}</td>
              <td>
                <button type="button" className="link" onClick={() => onRemove(i)}>
                  {t('delete')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Installment purchases and subscriptions first seen in the statement: created with it on confirmation. */
function NewItems({ payload, lines }: { payload: unknown; lines: unknown[] }) {
  const refs = new Set(lines.flatMap((l) => [str(l, 'installmentPurchaseRef'), str(l, 'subscriptionRef')]).filter(Boolean));
  const purchases = ((get(payload, 'newInstallmentPurchases') as unknown[] | undefined) ?? []).filter((n) => refs.has(str(n, 'ref')));
  const subscriptions = ((get(payload, 'newSubscriptions') as unknown[] | undefined) ?? []).filter((n) => refs.has(str(n, 'ref')));
  if (purchases.length === 0 && subscriptions.length === 0) return null;
  return (
    <div className="form-error">
      {purchases.length > 0 && (
        <>
          <p className="muted">{t('inbox_new_purchases')}</p>
          <ul className="rows nested">
            {purchases.map((n) => (
              <li key={str(n, 'ref')} className="row">
                <span className="grow">{str(n, 'description')}</span>
                <span className="amount">
                  {String(get(n, 'installmentsTotal'))} × {formatMoney(str(n, 'installmentAmount'), str(n, 'currency') || 'ARS')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {subscriptions.length > 0 && (
        <>
          <p className="muted">{t('inbox_new_subscriptions')}</p>
          <ul className="rows nested">
            {subscriptions.map((n) => (
              <li key={str(n, 'ref')} className="row">
                <span className="grow">{str(n, 'description')}</span>
                <span className="amount">{formatMoney(str(n, 'amount'), str(n, 'currency') || 'ARS')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
