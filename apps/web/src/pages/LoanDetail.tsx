import type { Loan, LoanSchedule } from '@meta31/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { currentPeriodIso, formatDate, formatMoney, formatPercent } from '../format';
import { columnLabel, derivedLabel, enumLabel, errorMessage, t, tableLabel } from '../glossary';
import { LOANS_KEY, loanAmount } from './Loans';

/** A loan's terms and its theoretical schedule (RF-23, RF-25). */
export function LoanDetail() {
  const { id = '' } = useParams();
  const loans = useQuery({ queryKey: LOANS_KEY, queryFn: () => api<Loan[]>('GET', '/api/loans') });
  const schedule = useQuery({
    queryKey: [...LOANS_KEY, id, 'schedule'],
    queryFn: () => api<LoanSchedule>('GET', `/api/loans/${id}/schedule`),
  });
  const loan = loans.data?.find((l) => l.id === id);

  if (loans.isPending) return <p className="muted">{t('loading')}</p>;
  if (loans.isError) return <p className="warning">{errorMessage(loans.error)}</p>;
  if (!loan) return <p className="warning">{t('error_not_found')}</p>;

  const amount = (v: string) => loanAmount(loan, v);
  const now = currentPeriodIso();

  return (
    <section className="page">
      <p className="muted">
        <Link to="/prestamos">{tableLabel('loan', true)}</Link>
      </p>
      <h1>{loan.lender}</h1>
      <div className="summary">
        <div>
          <div className="etiqueta">{columnLabel('loan', 'principal')}</div>
          <div className="amount">
            {formatMoney(loan.principal, loan.currency)}
            {loan.principalUva && <span className="note">{amount(loan.principalUva)}</span>}
          </div>
        </div>
        <div>
          <div className="etiqueta">{derivedLabel('remaining_principal')}</div>
          <div className="amount">{amount(loan.remainingPrincipal)}</div>
        </div>
        <div>
          <div className="etiqueta">{columnLabel('loan', 'nominal_annual_rate')}</div>
          <div className="amount">{formatPercent(loan.nominalAnnualRate)}</div>
        </div>
        <div>
          <div className="etiqueta">{columnLabel('loan', 'amortization_system')}</div>
          <div className="amount">{enumLabel('amortization_system', loan.amortizationSystem)}</div>
        </div>
      </div>
      {loan.quotedInstallment && loan.kind !== 'uva' && <QuotedCheck loan={loan} />}

      <h2>{t('loan_schedule')}</h2>
      <p className="muted">{t('loan_schedule_help')}</p>
      {schedule.isPending && <p className="muted">{t('loading')}</p>}
      {schedule.isError && <p className="warning">{errorMessage(schedule.error)}</p>}
      {schedule.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('schedule_number')}</th>
                <th>{t('schedule_due')}</th>
                <th>{t('schedule_days')}</th>
                <th>{t('schedule_principal')}</th>
                <th>{t('schedule_interest')}</th>
                <th>{t('schedule_vat')}</th>
                <th>{t('schedule_insurance')}</th>
                <th>{t('schedule_total')}</th>
                <th>{t('schedule_balance')}</th>
              </tr>
            </thead>
            <tbody>
              {schedule.data.rows.map((r) => (
                <tr key={r.number} className={r.period === now ? 'current' : r.period < now ? 'past' : ''}>
                  <td>{r.number}</td>
                  <td>{formatDate(r.dueDate)}</td>
                  <td>{r.days}</td>
                  <td>{amount(r.principal)}</td>
                  <td>{amount(r.interest)}</td>
                  <td>{amount(r.vat)}</td>
                  <td>{amount(r.insurance)}</td>
                  <td>{amount(r.total)}</td>
                  <td>{amount(r.closingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Theoretical installment 1 against the one the bank quoted: a large gap means a term was
 * loaded wrong (or the bank calculates differently, see modelo-de-datos 4.5).
 */
function QuotedCheck({ loan }: { loan: Loan }) {
  // whole pesos are enough to judge the gap; the exact deviation per installment comes in E2
  const theoretical = loan.firstInstallment;
  const quoted = loan.quotedInstallment!;
  const diff = centsDiff(quoted, theoretical);
  return (
    <p className="muted">
      {t('quoted_vs_theoretical', {
        theoretical: formatMoney(theoretical, loan.currency),
        quoted: formatMoney(quoted, loan.currency),
        deviation: `${diff.startsWith('-') ? '' : '+'}${formatMoney(diff, loan.currency)}`,
      })}
    </p>
  );
}

/** a − b for 2-decimal strings, in integer cents (exact; never floats on money). */
function centsDiff(a: string, b: string): string {
  const cents = (v: string) => {
    const [i = '0', d = ''] = v.split('.');
    return BigInt(i) * 100n + BigInt((d + '00').slice(0, 2));
  };
  const diff = cents(a) - cents(b);
  const abs = diff < 0n ? -diff : diff;
  return `${diff < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
