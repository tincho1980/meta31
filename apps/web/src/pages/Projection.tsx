import type { MonthProjection } from '@meta31/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { currentPeriodIso, formatMoney, formatMonth } from '../format';
import { errorMessage, t } from '../glossary';
import { PROJECTION_KEY } from './Month';

/**
 * 12-month projection (RF-31) with the installment load (RF-33): what comes in, what goes out
 * and what is left each month, in ARS and USD. No carry-over between months (rule 9).
 */
export function Projection() {
  const from = currentPeriodIso();
  const months = useQuery({
    queryKey: [...PROJECTION_KEY, from, 12],
    queryFn: () => api<MonthProjection[]>('GET', `/api/months/projection?from=${from}&months=12`),
  });

  return (
    <section className="page">
      <h1>{t('nav_projection')}</h1>
      <p className="muted">{t('projection_help')}</p>
      {months.isPending && <p className="muted">{t('loading')}</p>}
      {months.isError && <p className="warning">{errorMessage(months.error)}</p>}
      {months.data && (
        <>
          {months.data.some((m) => !m.ars) && <p className="warning">{t('missing_rate')}</p>}
          {months.data.some((m) => m.issues.length > 0) && <p className="warning">{t('projection_issues')}</p>}
          <div className="table-wrap">
            <table className="table projection">
              <thead>
                <tr>
                  <th>{t('month')}</th>
                  <th>{t('money_in')}</th>
                  <th>{t('money_out')}</th>
                  <th>{t('result')}</th>
                  <th>{t('result_usd')}</th>
                  <th>{t('in_installments')}</th>
                </tr>
              </thead>
              <tbody>
                {months.data.map((m) => (
                  <ProjectionRow key={m.period} month={m} current={m.period === from} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ProjectionRow({ month, current }: { month: MonthProjection; current: boolean }) {
  const ars = month.ars;
  const negative = ars?.result.startsWith('-') ?? false;
  const load = month.installmentLoad;
  const link = current ? '/' : `/?mes=${month.period.slice(0, 7)}`;
  return (
    <tr className={current ? 'current' : ''}>
      <td>
        <Link to={link} className="row-link">
          {formatMonth(month.period)}
        </Link>
      </td>
      <td className="income">{ars ? formatMoney(ars.incomes, 'ARS', { income: true }) : '—'}</td>
      <td>{ars ? formatMoney(ars.commitments, 'ARS') : '—'}</td>
      <td className={negative ? 'negative' : ''}>{ars ? formatMoney(ars.result, 'ARS') : '—'}</td>
      <td className={month.usd?.result.startsWith('-') ? 'negative' : ''}>{month.usd ? formatMoney(month.usd.result, 'USD') : '—'}</td>
      <td>{load?.percent ? `${load.percent.replace('.', ',')} %` : '—'}</td>
    </tr>
  );
}
