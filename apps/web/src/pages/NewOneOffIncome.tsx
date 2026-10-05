import { useNavigate, useSearchParams } from 'react-router';
import { CreateOneOffIncome } from '../components/OneOffIncomes';
import { useChoices } from '../components/rules';
import { currentPeriodIso } from '../format';
import { t } from '../glossary';

/**
 * Add a one-off income (RF-09) on its own: from Cargar, or from the month view with that month
 * already set (`?mes=YYYY-MM`). Once saved it goes back to that month.
 */
export function NewOneOffIncome() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const choices = useChoices('income');
  const mes = params.get('mes');
  const period = mes ? `${mes}-01` : currentPeriodIso();
  const backToMonth = () => navigate(period === currentPeriodIso() ? '/' : `/?mes=${period.slice(0, 7)}`);

  return (
    <section className="page">
      <h1>{t('one_off_income')}</h1>
      <p className="muted">{t('one_off_income_help')}</p>
      <CreateOneOffIncome choices={choices} period={period} onDone={backToMonth} />
    </section>
  );
}
