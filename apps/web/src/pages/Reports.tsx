import type { Category, FutureCommitment, LoanReport, SpendingByCategory } from '@meta31/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { addMonthsToMonthInput, currentPeriodIso, formatDate, formatMoney, formatMonth, sumDecimals } from '../format';
import { derivedLabel, errorMessage, t } from '../glossary';
import { loanAmount } from './Loans';

/** Loans report (RF-23, RF-25): installments left, end, debt and deviation from the schedule. */
export function LoansReport() {
  const reports = useQuery({ queryKey: ['reports', 'loans'], queryFn: () => api<LoanReport[]>('GET', '/api/reports/loans') });
  return (
    <section className="page">
      <h1>{t('report_loans')}</h1>
      <p className="muted">{t('report_loans_help')}</p>
      {reports.isPending && <p className="muted">{t('loading')}</p>}
      {reports.isError && <p className="warning">{errorMessage(reports.error)}</p>}
      {reports.data?.length === 0 && <p className="muted">{t('empty_list')}</p>}
      {reports.data?.map(({ loan, deviations, deviationTotal }) => (
        <div key={loan.id} className="group">
          <h3 className="group-head">
            <Link to={`/prestamos/${loan.id}`} className="row-link">
              {loan.lender}
            </Link>
            <span className="amount">{loanAmount(loan, loan.remainingPrincipal)}</span>
          </h3>
          <div className="summary">
            <div>
              <div className="etiqueta">{t('paid_installments')}</div>
              <div className="amount">{t('n_of_total', { n: String(loan.paidInstallments), total: String(loan.installmentsTotal) })}</div>
            </div>
            <div>
              <div className="etiqueta">{t('installments_left')}</div>
              <div className="amount">{loan.remainingInstallments}</div>
            </div>
            <div>
              <div className="etiqueta">{t('ends')}</div>
              <div className="amount">{formatMonth(loan.lastPeriod)}</div>
            </div>
            <div>
              <div className="etiqueta">{derivedLabel('remaining_principal')}</div>
              <div className="amount">{loanAmount(loan, loan.remainingPrincipal)}</div>
            </div>
            <div>
              <div className="etiqueta">{derivedLabel('installment_deviation')}</div>
              <div className={`amount${deviationTotal.startsWith('-') || deviationTotal === '0.00' ? '' : ' negative-text'}`}>
                {deviations.length ? `${deviationTotal.startsWith('-') ? '' : '+'}${formatMoney(deviationTotal, loan.currency)}` : '—'}
              </div>
            </div>
          </div>
          {deviations.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('schedule_number')}</th>
                    <th>{t('schedule_due')}</th>
                    <th>{derivedLabel('theoretical_installment')}</th>
                    <th>{t('schedule_actual')}</th>
                    <th>{derivedLabel('installment_deviation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {deviations.map((d) => (
                    <tr key={d.number}>
                      <td>{d.number}</td>
                      <td>{formatDate(d.dueDate)}</td>
                      <td>{formatMoney(d.theoretical, loan.currency)}</td>
                      <td>{formatMoney(d.actual, loan.currency)}</td>
                      <td>
                        {d.amount.startsWith('-') ? '' : '+'}
                        {formatMoney(d.amount, loan.currency)} ({d.percent.replace('.', ',')} %)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/** Spending by category (report): where the money goes each month. */
export function SpendingReport() {
  const [params, setParams] = useSearchParams();
  const now = currentPeriodIso();
  const period = params.get('mes') ? `${params.get('mes')}-01` : now;
  const report = useQuery({
    queryKey: ['reports', 'spending', period],
    queryFn: () => api<SpendingByCategory>('GET', `/api/reports/spending-by-category?period=${period}`),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('GET', '/api/categories') });
  const name = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '…';
  const go = (delta: number) => {
    const target = addMonthsToMonthInput(period.slice(0, 7), delta);
    setParams(target === now.slice(0, 7) ? {} : { mes: target });
  };
  const max = report.data?.rows[0]?.amountArs;

  return (
    <section className="page">
      <h1>{t('report_spending')}</h1>
      <p className="muted">{t('report_spending_help')}</p>
      <div className="month-nav plain">
        <button type="button" className="month-arrow" onClick={() => go(-1)} aria-label={t('previous_month')}>
          ‹
        </button>
        <span className="etiqueta">{formatMonth(period)}</span>
        <button type="button" className="month-arrow" onClick={() => go(1)} aria-label={t('next_month')}>
          ›
        </button>
      </div>
      {report.isPending && <p className="muted">{t('loading')}</p>}
      {report.isError && <p className="warning">{errorMessage(report.error)}</p>}
      {report.data && (
        <>
          <h3 className="group-head">
            <span>{t('money_out')}</span>
            <span className="amount">{formatMoney(report.data.total, 'ARS')}</span>
          </h3>
          <ul className="rows">
            {report.data.rows.map((r) => (
              <li key={r.categoryId} className="row bar-row">
                <span className="grow">
                  {name(r.categoryId)}
                  <span className="bar" style={{ width: `${max ? share(r.amountArs, max) : 0}%` }} aria-hidden="true" />
                </span>
                <span className="amount">
                  {r.partial && '~ '}
                  {formatMoney(r.amountArs, 'ARS')}
                  <span className="note">{share(r.amountArs, report.data.total)} %</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** a / b as a whole percent, from 2-decimal strings (exact; display only). */
function share(a: string, b: string): number {
  const cents = (v: string) => BigInt(sumDecimals([v]).replace('.', ''));
  const den = cents(b);
  return den === 0n ? 0 : Number((cents(a) * 100n + den / 2n) / den);
}

const KINDS: FutureCommitment['kind'][] = ['installment_purchase', 'loan', 'subscription', 'one_off_expense'];
const KIND_LABEL: Record<FutureCommitment['kind'], string> = {
  installment_purchase: 'future_installments',
  loan: 'future_loans',
  subscription: 'future_subscriptions',
  one_off_expense: 'future_one_offs',
};

/** Future commitments by type (report): what is still running, its monthly amount and its end. */
export function FutureCommitmentsReport() {
  const items = useQuery({ queryKey: ['reports', 'future'], queryFn: () => api<FutureCommitment[]>('GET', '/api/reports/future-commitments') });
  return (
    <section className="page">
      <h1>{t('report_future')}</h1>
      <p className="muted">{t('report_future_help')}</p>
      {items.isPending && <p className="muted">{t('loading')}</p>}
      {items.isError && <p className="warning">{errorMessage(items.error)}</p>}
      {items.data &&
        KINDS.map((kind) => {
          const list = items.data.filter((i) => i.kind === kind);
          if (list.length === 0) return null;
          const currencies = [...new Set(list.map((i) => i.currency))];
          return (
            <div key={kind} className="group">
              <h3 className="group-head">
                <span>{t(KIND_LABEL[kind])}</span>
                <span className="amount">
                  {currencies
                    .map((c) => formatMoney(sumDecimals(list.filter((i) => i.currency === c).map((i) => i.monthlyAmount)), c))
                    .join(' + ')}
                  <span className="note">{t('per_month')}</span>
                </span>
              </h3>
              <ul className="rows">
                {list.map((i) => (
                  <li key={i.id} className="row">
                    <span className="grow">
                      {i.description}
                      <span className="note">
                        {[
                          i.detail,
                          i.lastPeriod ? t('until_month', { month: formatMonth(i.lastPeriod) }) : t('until_cancelled'),
                          i.remaining !== null ? t('installments_remaining', { n: String(i.remaining) }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="amount">{formatMoney(i.monthlyAmount, i.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </section>
  );
}
