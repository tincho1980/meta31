import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ApiError, getMe } from './api';
import { localAuth } from './auth';
import { Layout } from './components/Layout';
import { t } from './glossary';
import { Categories } from './pages/Categories';
import { ExchangeRates } from './pages/ExchangeRates';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
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
    <main className="centered">
      <h1 className="brand">{t('app_name')}</h1>
      {children}
    </main>
  );
}

function SignIn() {
  const signIn = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
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

  return (
    <Layout userName={me.data.name} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<Home name={me.data.name} />} />
        <Route path="/configuracion" element={<Settings />} />
        <Route path="/configuracion/categorias" element={<Categories />} />
        <Route path="/configuracion/cotizaciones" element={<ExchangeRates />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
