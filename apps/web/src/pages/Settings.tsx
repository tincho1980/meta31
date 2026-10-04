import { Link } from 'react-router';
import { t, tableLabel } from '../glossary';

/** Master data that projections rely on. More entries join as each load screen is built. */
const sections = [
  { to: '/configuracion/categorias', table: 'category' },
  { to: '/configuracion/cotizaciones', table: 'exchange_rate' },
];

export function Settings() {
  return (
    <section className="page">
      <h1>{t('nav_settings')}</h1>
      <p className="muted">{t('settings_intro')}</p>
      <ul className="menu">
        {sections.map((s) => (
          <li key={s.to}>
            <Link to={s.to}>{tableLabel(s.table, true)}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
