import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ApiError, getMe, type Me } from './api';
import { t } from './glossary';
import { supabase } from './supabase';

type MeState =
  | { kind: 'loading' }
  | { kind: 'ok'; me: Me }
  | { kind: 'forbidden' }
  | { kind: 'error' };

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Shell>{t('loading')}</Shell>;
  if (session === null) return <SignIn />;
  return <Home session={session} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <h1 className="brand">{t('app_name')}</h1>
      {children}
    </main>
  );
}

function SignIn() {
  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  return (
    <Shell>
      <button type="button" className="primary" onClick={signIn}>
        {t('sign_in_with_google')}
      </button>
    </Shell>
  );
}

function Home({ session }: { session: Session }) {
  const [state, setState] = useState<MeState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => !cancelled && setState({ kind: 'ok', me }))
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  const signOut = () => supabase.auth.signOut();

  return (
    <Shell>
      {state.kind === 'loading' && <p>{t('loading')}</p>}
      {state.kind === 'ok' && <p className="greeting">{t('greeting', { name: state.me.name })}</p>}
      {state.kind === 'forbidden' && (
        <p className="warning">{t('not_authorized', { email: session.user.email ?? '' })}</p>
      )}
      {state.kind === 'error' && <p className="warning">{t('error_generic')}</p>}
      <button type="button" className="secondary" onClick={signOut}>
        {t('sign_out')}
      </button>
    </Shell>
  );
}
