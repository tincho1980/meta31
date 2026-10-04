import { NavLink } from 'react-router';
import { t } from '../glossary';

type Props = { userName: string; onSignOut: () => void; children: React.ReactNode };

export function Layout({ userName, onSignOut, children }: Props) {
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand-link">
          {t('app_name')}
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            {t('nav_home')}
          </NavLink>
          <NavLink to="/configuracion">{t('nav_settings')}</NavLink>
        </nav>
        <div className="user">
          <span className="user-name">{userName}</span>
          <button type="button" className="link" onClick={onSignOut}>
            {t('sign_out')}
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
