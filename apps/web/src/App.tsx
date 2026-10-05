import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { ApiError, getMe } from './api';
import { localAuth } from './auth';
import { Layout } from './components/Layout';
import { Logo } from './components/Logo';
import { t } from './glossary';
import { CardDetail } from './pages/CardDetail';
import { Categories } from './pages/Categories';
import { CreditCards } from './pages/CreditCards';
import { ExchangeRates } from './pages/ExchangeRates';
import { FinancialCost } from './pages/FinancialCost';
import { FutureCommitmentsReport, LoansReport, SpendingReport } from './pages/Reports';
import { Inbox } from './pages/Inbox';
import { IncomeSources } from './pages/IncomeSources';
import { LoanDetail } from './pages/LoanDetail';
import { Loans } from './pages/Loans';
import { Load, More } from './pages/Menus';
import { Month } from './pages/Month';
import { NewOneOffIncome } from './pages/NewOneOffIncome';
import { OAuthConsent } from './pages/OAuthConsent';
import { OneOffExpenses } from './pages/OneOffExpenses';
import { Projection } from './pages/Projection';
import { Properties } from './pages/Properties';
import { RecurringExpenses } from './pages/RecurringExpenses';
import { supabase } from './supabase';

export function App() {
  if (localAuth) return <Authenticated identity={{ key: 'local', email: 'local' }} onSignOut={() => {}} />;
  return <WithSupabase />;
}

function WithSupabase() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Centered>{t('loading')}</Centered>;
  if (session === null) return <SignIn />;
  return (
    <Authenticated
      identity={{ key: session.user.id, email: session.user.email ?? '' }}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="centered on-green">
      <Logo />
      <p className="tagline">{t('tagline')}</p>
      {children}
    </main>
  );
}

function SignIn() {
  const signIn = () =>
    // back to where the user was: the consent screen keeps its authorization_id
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  return (
    <Centered>
      <button type="button" className="primary" onClick={signIn}>
        {t('sign_in_with_google')}
      </button>
    </Centered>
  );
}

type Identity = { key: string; email: string };

function Authenticated({ identity, onSignOut: signOut }: { identity: Identity; onSignOut: () => void }) {
  const me = useQuery({ queryKey: ['me', identity.key], queryFn: getMe });
  const location = useLocation();

  if (me.isPending) return <Centered>{t('loading')}</Centered>;
  if (me.isError) {
    const forbidden = me.error instanceof ApiError && me.error.status === 403;
    return (
      <Centered>
        <p className="warning">{forbidden ? t('not_authorized', { email: identity.email }) : t('error_generic')}</p>
        <button type="button" className="secondary" onClick={signOut}>
          {t('sign_out')}
        </button>
      </Centered>
    );
  }

  // connecting a Claude (MCP over OAuth): its own screen, without the app's navigation
  if (location.pathname === '/oauth/consent') return <OAuthConsent />;

  return (
    <Layout userName={me.data.name} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<Month />} />
        <Route path="/cargar" element={<Load />} />
        <Route path="/mas" element={<More onSignOut={signOut} />} />
        <Route path="/categorias" element={<Categories />} />
        <Route path="/cotizaciones" element={<ExchangeRates />} />
        <Route path="/gastos-recurrentes" element={<RecurringExpenses />} />
        <Route path="/gastos-puntuales" element={<OneOffExpenses />} />
        <Route path="/ingreso-puntual" element={<NewOneOffIncome />} />
        <Route path="/reportes/costo-financiero" element={<FinancialCost />} />
        <Route path="/reportes/prestamos" element={<LoansReport />} />
        <Route path="/reportes/gasto-por-categoria" element={<SpendingReport />} />
        <Route path="/reportes/compromisos-futuros" element={<FutureCommitmentsReport />} />
        <Route path="/proyeccion" element={<Projection />} />
        <Route path="/bandeja" element={<Inbox />} />
        <Route path="/tarjetas" element={<CreditCards />} />
        <Route path="/tarjetas/:id" element={<CardDetail />} />
        <Route path="/prestamos" element={<Loans />} />
        <Route path="/prestamos/:id" element={<LoanDetail />} />
        <Route path="/propiedades" element={<Properties />} />
        <Route path="/ingresos" element={<IncomeSources />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
