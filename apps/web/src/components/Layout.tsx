import type { ExchangeRate } from '@meta31/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink } from 'react-router';
import { api } from '../api';
import { formatDate, formatDecimal } from '../format';
import { t } from '../glossary';
import { Logo } from './Logo';

type Props = { userName: string; onSignOut: () => void; children: React.ReactNode };

/** Main navigation (manual de marca): sidebar on desktop, bottom bar with Cargar in the middle on the phone. */
const main = [
  { to: '/', key: 'nav_month', end: true },
  { to: '/proyeccion', key: 'nav_projection' },
  { to: '/bandeja', key: 'nav_inbox' },
  { to: '/mas', key: 'nav_more' },
];
const whatWeHave = [
  { to: '/tarjetas', key: 'nav_cards' },
  { to: '/prestamos', key: 'nav_loans' },
  { to: '/propiedades', key: 'nav_properties' },
  { to: '/ingresos', key: 'nav_incomes' },
  { to: '/gastos-recurrentes', key: 'nav_recurring_expenses' },
];

function PlusIcon({ size, stroke }: { size: number; stroke: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M11 3v16M3 11h16" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

/** Latest rate of each pair for the sidebar footer. */
function LatestRates() {
  const rates = useQuery({ queryKey: ['exchange-rates'], queryFn: () => api<ExchangeRate[]>('GET', '/api/exchange-rates') });
  if (!rates.data) return null;
  // the API lists newest first within each pair
  const usd = rates.data.find((r) => r.pair === 'USD_ARS');
  const uyu = rates.data.find((r) => r.pair === 'UYU_USD');
  if (!usd && !uyu) return null;
  const latest = [usd, uyu].filter((r): r is ExchangeRate => Boolean(r)).map((r) => r.validFrom).sort().at(-1)!;
  return (
    <Link to="/cotizaciones" className="rates">
      {usd && `USD ${formatDecimal(usd.rate)}`}
      {usd && uyu && ' · '}
      {uyu && `UYU ${formatDecimal(uyu.rate)}`}
      <br />
      {t('rates_updated', { date: formatDate(latest).slice(0, 5) })}
    </Link>
  );
}

export function Layout({ userName, onSignOut, children }: Props) {
  const initial = userName.slice(0, 1).toUpperCase();
  return (
    <div className="app">
      <nav className="sidebar on-green" aria-label={t('nav_main')}>
        <Link to="/" aria-label={t('nav_month')}>
          <Logo />
        </Link>
        <NavLink to="/cargar" className="load">
          <PlusIcon size={16} stroke={2.8} />
          {t('nav_load')}
        </NavLink>
        <div className="group">
          {main.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end ?? false}>
              {t(item.key)}
            </NavLink>
          ))}
        </div>
        <div className="group">
          <div className="group-label">{t('nav_what_we_have')}</div>
          {whatWeHave.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {t(item.key)}
            </NavLink>
          ))}
        </div>
        <div className="foot">
          <LatestRates />
          <div className="who">
            <span className="avatar" aria-hidden="true">
              {initial}
            </span>
            <span>{userName}</span>
          </div>
          <button type="button" className="link" onClick={onSignOut}>
            {t('sign_out')}
          </button>
        </div>
      </nav>

      <header className="mobile-top">
        <Link to="/" aria-label={t('nav_month')}>
          <Logo />
        </Link>
        <span className="avatar" aria-label={userName} role="img">
          {initial}
        </span>
      </header>

      <main className="content">{children}</main>

      <nav className="bottombar" aria-label={t('nav_main')}>
        <NavLink to="/" end>
          {t('nav_month')}
        </NavLink>
        <NavLink to="/proyeccion">{t('nav_projection')}</NavLink>
        <NavLink to="/cargar" className="load" aria-label={t('nav_load')}>
          <PlusIcon size={22} stroke={2.6} />
        </NavLink>
        <NavLink to="/bandeja">{t('nav_inbox')}</NavLink>
        <NavLink to="/mas">{t('nav_more')}</NavLink>
      </nav>
    </div>
  );
}
