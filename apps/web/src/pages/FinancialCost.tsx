import type { FinancialCostRow } from '@meta31/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatMoney, formatMonth, sumDecimals } from '../format';
import { errorMessage, t } from '../glossary';

/**
 * Financial cost of the cards (report, rule 4): how much goes in interest for not paying the
 * total, admin fees and taxes, per card and month. It comes from the statement breakdowns.
 */
export function FinancialCost() {
  const rows = useQuery({ queryKey: ['reports', 'financial-cost'], queryFn: () => api<FinancialCostRow[]>('GET', '/api/reports/financial-cost') });
  const months = [...new Set((rows.data ?? []).map((r) => r.period))].sort().reverse();

  return (
    <section className="page">
      <h1>{t('report_financial_cost')}</h1>
      <p className="muted">{t('report_financial_cost_help')}</p>
      {rows.isPending && <p className="muted">{t('loading')}</p>}
      {rows.isError && <p className="warning">{errorMessage(rows.error)}</p>}
      {rows.data && rows.data.length === 0 && <p className="muted">{t('report_financial_cost_empty')}</p>}
      {months.map((period) => {
        const inMonth = rows.data!.filter((r) => r.period === period);
        const totalArs = sumDecimals(inMonth.map((r) => r.totalArs).filter((v): v is string => v !== null));
        return (
          <div key={period} className="group">
            <h3 className="group-head">
              <span>{formatMonth(period)}</span>
              <span className="amount">{formatMoney(totalArs, 'ARS')}</span>
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('card')}</th>
                    <th>{t('cost_interest')}</th>
                    <th>{t('cost_admin_fee')}</th>
                    <th>{t('cost_tax')}</th>
                    <th>{t('cost_total')}</th>
                    <th>{t('cost_total_ars')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inMonth.map((r) => (
                    <tr key={`${r.creditCardId}-${r.currency}`}>
                      <td>{r.cardName}</td>
                      <td>{formatMoney(r.interest, r.currency)}</td>
                      <td>{formatMoney(r.adminFee, r.currency)}</td>
                      <td>{formatMoney(r.tax, r.currency)}</td>
                      <td>{formatMoney(r.total, r.currency)}</td>
                      <td>{r.totalArs ? formatMoney(r.totalArs, 'ARS') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
