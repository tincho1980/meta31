import { Link } from 'react-router';
import { t, tableLabel } from '../glossary';

type Entry = { to: string; label: string };

function Menu({ entries }: { entries: Entry[] }) {
  return (
    <ul className="menu">
      {entries.map((e) => (
        <li key={e.to}>
          <Link to={e.to}>{e.label}</Link>
        </li>
      ))}
    </ul>
  );
}

/** Cargar (manual de marca): opens manual loading. Grows as each load screen is built. */
export function Load() {
  return (
    <section className="page">
      <h1>{t('nav_load')}</h1>
      <p className="muted">{t('load_intro')}</p>
      <Menu
        entries={[
          { to: '/ingresos', label: tableLabel('income_source') },
          { to: '/gastos-recurrentes', label: tableLabel('recurring_expense') },
          { to: '/propiedades', label: tableLabel('property') },
          { to: '/cotizaciones', label: tableLabel('exchange_rate') },
          { to: '/categorias', label: tableLabel('category') },
        ]}
      />
    </section>
  );
}

/** Más: on the phone it also holds "Lo que tenemos" (on desktop it lives in the sidebar). */
export function More({ onSignOut }: { onSignOut: () => void }) {
  return (
    <section className="page">
      <h1>{t('nav_more')}</h1>
      <h2>{t('nav_what_we_have')}</h2>
      <Menu
        entries={[
          { to: '/tarjetas', label: t('nav_cards') },
          { to: '/prestamos', label: t('nav_loans') },
          { to: '/propiedades', label: t('nav_properties') },
          { to: '/ingresos', label: t('nav_incomes') },
        ]}
      />
      <h2>{t('nav_settings')}</h2>
      <p className="muted">{t('more_intro')}</p>
      <Menu
        entries={[
          { to: '/cotizaciones', label: tableLabel('exchange_rate', true) },
          { to: '/categorias', label: tableLabel('category', true) },
        ]}
      />
      <div className="end">
        <button type="button" className="secondary" onClick={onSignOut}>
          {t('sign_out')}
        </button>
      </div>
    </section>
  );
}

/** Screens that are not built yet keep their place in the navigation. */
export function Pending({ titleKey }: { titleKey: string }) {
  return (
    <section className="page">
      <h1>{t(titleKey)}</h1>
      <p className="muted">{t('pending_screen')}</p>
    </section>
  );
}
