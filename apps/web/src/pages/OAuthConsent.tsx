import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Logo } from '../components/Logo';
import { t } from '../glossary';
import { supabase } from '../supabase';

/**
 * Consent screen of the OAuth 2.1 server (Supabase Auth, E3 decision of 4/10): when someone
 * connects their Claude to Meta31, Supabase sends them here with an `authorization_id`. Only a
 * signed-in user of the allowlist reaches it (it renders inside the authenticated app).
 */
export function OAuthConsent() {
  const [params] = useSearchParams();
  const id = params.get('authorization_id');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const details = useQuery({
    queryKey: ['oauth-authorization', id],
    enabled: Boolean(id),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id!);
      if (error) throw error;
      // consented before: straight back to Claude
      if (!('authorization_id' in data)) window.location.assign(data.redirect_url);
      return data;
    },
  });

  const decide = async (approve: boolean) => {
    setBusy(true);
    setFailed(false);
    const { error } = approve ? await supabase.auth.oauth.approveAuthorization(id!) : await supabase.auth.oauth.denyAuthorization(id!);
    // on success the browser is already going back to the client
    if (error) {
      setBusy(false);
      setFailed(true);
    }
  };

  const data = details.data && 'authorization_id' in details.data ? details.data : null;
  return (
    <main className="centered on-green consent">
      <Logo />
      {!id || details.isError ? (
        <p className="warning">{t('consent_invalid')}</p>
      ) : !data ? (
        <p className="tagline">{t('loading')}</p>
      ) : (
        <>
          <h1>{t('consent_title', { client: data.client.name || 'Claude' })}</h1>
          <p>{t('consent_body')}</p>
          <p className="tagline">{t('consent_account', { email: data.user.email })}</p>
          <div className="form-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => decide(true)}>
              {t('consent_approve')}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => decide(false)}>
              {t('consent_deny')}
            </button>
          </div>
          {failed && <p className="warning">{t('error_generic')}</p>}
        </>
      )}
    </main>
  );
}
