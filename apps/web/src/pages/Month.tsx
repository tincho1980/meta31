import type { MonthProjection, OpenMonthResult, ProjectionLine } from '@meta31/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { MonthPath } from '../components/MonthPath';
import { glyphLabel, StatusGlyph } from '../components/StatusGlyph';
import { addMonthsToMonthInput, currentPeriodIso, formatMoney, formatMoneyShort, formatMonth, formatWeekdayDay, todayIso } from '../format';
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

      <h2>{t('this_month')}</h2>
      {month.incomes.length + month.commitments.length === 0 ? (
        <p className="muted">{t('empty_list')}</p>
      ) : (
        <ul className="rows">
          {sortByDate(month.incomes).map((l) => (
            <LineRow key={l.sourceKey ?? l.id} line={l} isIncome />
          ))}
          {sortByDate(month.commitments).map((l) => (
            <LineRow key={l.sourceKey ?? l.id} line={l} isIncome={false} />
          ))}
        </ul>
      )}
      <Legend />
    </>
  );
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
  const when = line.date ? t(isIncome ? 'comes_in_on' : 'due_on', { day: formatWeekdayDay(line.date) }) : null;
  return (
    <li className={`row line${done ? ' done' : ''}`}>
      <StatusGlyph line={line} isIncome={isIncome} />
      <span className="grow">
        {line.description}
        {when && <span className="note">{when}</span>}
      </span>
      <span className={`amount${isIncome ? ' income' : ''}${estimate ? ' estimate' : ''}`}>
        {formatMoney(line.amount, line.currency, { income: isIncome, estimate })}
      </span>
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
