import type { CancelledLine, Category, MonthProjection, OpenMonthResult, ProjectionLine } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { LineActions } from '../components/LineActions';
import { MonthPath } from '../components/MonthPath';
import { glyphLabel, StatusGlyph } from '../components/StatusGlyph';
import {
  addMonthsToMonthInput,
  currentPeriodIso,
  formatMoney,
  formatMoneyShort,
  formatMonth,
  formatWeekdayDay,
  sumDecimals,
  todayIso,
} from '../format';
import { errorMessage, t } from '../glossary';

export const PROJECTION_KEY = ['projection'];

/** Days in the month of a period 'YYYY-MM-01'. */
const daysIn = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
};

/**
 * Month view (RF-30, estimated): what comes in, what goes out and what is left at the end.
 * Opening the current month materializes its commitments and incomes (D1, idempotent);
 * other months are shown as projected, without storing anything.
 */
export function Month() {
  const [params, setParams] = useSearchParams();
  const now = currentPeriodIso();
  const period = params.get('mes') ? `${params.get('mes')}-01` : now;
  const isCurrent = period === now;
  const queryClient = useQueryClient();

  const open = useMutation({
    mutationFn: () => api<OpenMonthResult>('POST', `/api/months/${now}/open`, {}),
    onSuccess: (r) => (r.status === 'opened' ? queryClient.invalidateQueries({ queryKey: PROJECTION_KEY }) : undefined),
  });
  useEffect(() => {
    if (isCurrent && open.isIdle) open.mutate();
  }, [isCurrent, open]);

  const month = useQuery({
    queryKey: [...PROJECTION_KEY, period, 1],
    queryFn: () => api<MonthProjection[]>('GET', `/api/months/projection?from=${period}&months=1`),
    enabled: !isCurrent || !open.isPending,
    select: (r) => r[0]!,
  });

  const go = (delta: number) => {
    const target = addMonthsToMonthInput(period.slice(0, 7), delta);
    setParams(target === now.slice(0, 7) ? {} : { mes: target });
  };

  return (
    <section className="page month">
      <MonthHeader period={period} isCurrent={isCurrent} month={month.data} onPrev={() => go(-1)} onNext={() => go(1)} />
      {month.isPending && <p className="muted">{t('loading')}</p>}
      {(month.isError || open.isError) && <p className="warning">{errorMessage(month.error ?? open.error)}</p>}
      {month.data && <MonthBody month={month.data} />}
    </section>
  );
}

function MonthHeader({ period, isCurrent, month, onPrev, onNext }: {
  period: string;
  isCurrent: boolean;
  month: MonthProjection | undefined;
  onPrev: () => void;
  onNext: () => void;
}) {
  const result = month?.ars?.result;
  const negative = result?.startsWith('-') ?? false;
  const dueDays = new Set(
    (month?.commitments ?? []).filter((l) => l.date && l.date.startsWith(period.slice(0, 7))).map((l) => Number(l.date!.slice(8, 10))),
  );
  return (
    <header className="month-head on-green">
      <div className="month-nav">
        <button type="button" className="month-arrow" onClick={onPrev} aria-label={t('previous_month')}>
          ‹
        </button>
        <span className="etiqueta">{formatMonth(period)}</span>
        <button type="button" className="month-arrow" onClick={onNext} aria-label={t('next_month')}>
          ›
        </button>
      </div>
      <p className="month-lead">{t('you_reach_31_with')}</p>
      <p className={`month-amount${negative ? ' negative' : ''}`}>{result ? formatMoney(result, 'ARS') : '—'}</p>
      {!isCurrent && <p className="month-note">{t('projected_month')}</p>}
      <MonthPath days={daysIn(period)} today={isCurrent ? Number(todayIso().slice(8, 10)) : null} dueDays={dueDays} />
    </header>
  );
}

function MonthBody({ month }: { month: MonthProjection }) {
  const load = month.installmentLoad;
  return (
    <>
      {month.issues.length > 0 && <p className="warning">{t('projection_issues')}</p>}
      {!month.ars && <p className="warning">{t('missing_rate')}</p>}
      <div className="summary-cards">
        <div className="summary-card">
          <span className="etiqueta">{t('money_in')}</span>
          <span className="amount income">{month.ars ? <Both value={month.ars.incomes} income /> : '—'}</span>
        </div>
        <div className="summary-card">
          <span className="etiqueta">{t('money_out')}</span>
          <span className="amount">{month.ars ? <Both value={month.ars.commitments} /> : '—'}</span>
        </div>
        <div className="summary-card">
          <span className="etiqueta">{t('in_installments')}</span>
          <span className="amount">{load?.percent ? `${load.percent.replace('.', ',')} %` : '—'}</span>
          {load && (
            <span className="note">
              <Both value={load.amountArs} />
            </span>
          )}
        </div>
      </div>

      <MonthLines month={month} />
      <Cancelled period={month.period} />
      <Legend />
    </>
  );
}

type View = 'all' | 'in' | 'out';
const VIEWS: View[] = ['all', 'in', 'out'];
const VIEW_LABEL: Record<View, string> = { all: 'view_all', in: 'money_in', out: 'money_out' };

/**
 * The month's lines, ordered: what comes in first, then what goes out grouped by category with
 * a subtotal in ARS each (biggest first). A filter shows everything, only Entra or only Sale.
 */
function MonthLines({ month }: { month: MonthProjection }) {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS as string[]).includes(params.get('ver') ?? '') ? (params.get('ver') as View) : 'all';
  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete('ver');
    else next.set('ver', v);
    setParams(next, { replace: true });
  };
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('GET', '/api/categories') });
  const categoryName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '…';

  // expenses by category, biggest subtotal first
  const byCategory = new Map<string, ProjectionLine[]>();
  for (const l of month.commitments) byCategory.set(l.categoryId, [...(byCategory.get(l.categoryId) ?? []), l]);
  const groups = [...byCategory]
    .map(([categoryId, lines]) => ({ categoryId, lines: sortByDate(lines), subtotal: subtotalArs(lines) }))
    .sort((a, b) => compareDecimals(b.subtotal.value, a.subtotal.value) || categoryName(a.categoryId).localeCompare(categoryName(b.categoryId)));

  if (month.incomes.length + month.commitments.length === 0) {
    return (
      <>
        <h2>{t('this_month')}</h2>
        <p className="muted">{t('empty_list')}</p>
      </>
    );
  }

  return (
    <>
      <div className="lines-head">
        <h2>{t('this_month')}</h2>
        <div className="segmented" role="group" aria-label={t('filter')}>
          {VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {t(VIEW_LABEL[v])}
            </button>
          ))}
        </div>
      </div>

      {view !== 'out' && month.incomes.length > 0 && (
        <section className="line-group">
          <h3 className="group-head">
            <span>{t('money_in')}</span>
            {month.ars && <span className="amount income">{formatMoney(month.ars.incomes, 'ARS', { income: true })}</span>}
          </h3>
          <ul className="rows">
            {sortByDate(month.incomes).map((l) => (
              <LineRow key={l.sourceKey ?? l.id} line={l} isIncome />
            ))}
          </ul>
        </section>
      )}

      {view !== 'in' && month.commitments.length > 0 && (
        <section className="line-group">
          <h3 className="group-head">
            <span>{t('money_out')}</span>
            {month.ars && <span className="amount">{formatMoney(month.ars.commitments, 'ARS')}</span>}
          </h3>
          {groups.map((g) => (
            <div key={g.categoryId} className="category-group">
              <h4 className="category-head">
                <span>{categoryName(g.categoryId)}</span>
                <span className="amount">
                  {g.subtotal.partial && '~ '}
                  {formatMoney(g.subtotal.value, 'ARS')}
                </span>
              </h4>
              <ul className="rows">
                {g.lines.map((l) => (
                  <LineRow key={l.sourceKey ?? l.id} line={l} isIncome={false} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/** What was cancelled this month, to restore it if it was a mistake. */
function Cancelled({ period }: { period: string }) {
  const queryClient = useQueryClient();
  const key = [...PROJECTION_KEY, period, 'cancelled'];
  const list = useQuery({ queryKey: key, queryFn: () => api<CancelledLine[]>('GET', `/api/months/${period}/cancelled`) });
  const restore = useMutation({
    mutationFn: (l: CancelledLine) => api('POST', `/api/${l.kind === 'income' ? 'incomes' : 'commitments'}/${l.id}/restore`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROJECTION_KEY }),
  });
  if (!list.data || list.data.length === 0) return null;
  return (
    <details className="cancelled">
      <summary>{t('cancelled_count', { n: String(list.data.length) })}</summary>
      <ul className="rows">
        {list.data.map((l) => (
          <li key={l.id} className="row inactive">
            <span className="grow">
              {l.description}
              {l.reason && <span className="note">{l.reason}</span>}
            </span>
            <span className="amount">{formatMoney(l.amount, l.currency, { income: l.kind === 'income' })}</span>
            <span className="actions">
              <button type="button" className="link" disabled={restore.isPending} onClick={() => restore.mutate(l)}>
                {t('restore')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {restore.isError && <p className="warning">{errorMessage(restore.error)}</p>}
    </details>
  );
}

/** Sum of the lines in ARS; `partial` when some line could not be converted (missing rate). */
function subtotalArs(lines: ProjectionLine[]): { value: string; partial: boolean } {
  const known = lines.map((l) => l.amountArs).filter((v): v is string => v !== null);
  return { value: sumDecimals(known), partial: known.length < lines.length };
}

/** Compares two 2-decimal strings without converting them to number. */
function compareDecimals(a: string, b: string): number {
  // sumDecimals normalizes to exactly 2 decimals, so dropping the point gives integer cents
  const d = BigInt(sumDecimals([a]).replace('.', '')) - BigInt(sumDecimals([b]).replace('.', ''));
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

/** Full amount on desktop, abbreviated on the phone (manual de marca). */
function Both({ value, income = false }: { value: string; income?: boolean }) {
  return (
    <>
      <span className="wide-only">{formatMoney(value, 'ARS', { income })}</span>
      <span className="narrow-only">{formatMoneyShort(value, 'ARS', { income })}</span>
    </>
  );
}

const sortByDate = (lines: ProjectionLine[]) =>
  [...lines].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.description.localeCompare(b.description));

function LineRow({ line, isIncome }: { line: ProjectionLine; isIncome: boolean }) {
  const done = line.status === 'paid' || line.status === 'received';
  // estimated until it is paid (in full or in part): manual de marca, '~' and tinta-suave
  const estimate = !isIncome && (line.status === null || line.status === 'pending');
  const [open, setOpen] = useState(false);
  const when = line.date
    ? t(line.postponed ? 'moved_to' : isIncome ? 'comes_in_on' : 'due_on', { day: formatWeekdayDay(line.date) })
    : null;
  // manual de marca: "Parcial · pagaste $ 300.000 de $ 624.300"
  const partial =
    line.status === 'partially_paid' && line.paid
      ? t('paid_of', { paid: formatMoney(line.paid, line.currency), total: formatMoney(line.amount, line.currency) })
      : null;
  return (
    <li className={`row line${done ? ' done' : ''}${open ? ' open' : ''}`}>
      <button type="button" className="line-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StatusGlyph line={line} isIncome={isIncome} />
        <span className="grow">
          {line.description}
          {(partial ?? when) && <span className="note">{partial ?? when}</span>}
        </span>
        <span className={`amount${isIncome ? ' income' : ''}${estimate ? ' estimate' : ''}`}>
          {formatMoney(line.amount, line.currency, { income: isIncome, estimate })}
        </span>
      </button>
      {open && <LineActions line={line} isIncome={isIncome} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** On desktop the legend is always at the foot of the list (manual de marca). */
function Legend() {
  const sample = (status: ProjectionLine['status'], postponed = false): ProjectionLine => ({
    id: null,
    sourceKey: null,
    origin: 'loan',
    originId: null,
    description: '',
    categoryId: '00000000-0000-4000-8000-000000000000',
    date: null,
    currency: 'ARS',
    amount: '0',
    stored: true,
    status,
    postponed,
    amountArs: null,
    paid: null,
  });
  const items: [ProjectionLine, boolean][] = [
    [sample('pending'), false],
    [sample('partially_paid'), false],
    [sample('pending', true), false],
    [sample('paid'), false],
    [sample('expected'), true],
  ];
  return (
    <ul className="legend">
      {items.map(([line, isIncome], i) => (
        <li key={i}>
          <StatusGlyph line={line} isIncome={isIncome} />
          <span>{isIncome ? t('to_collect') : glyphLabel(line, isIncome)}</span>
        </li>
      ))}
    </ul>
  );
}
