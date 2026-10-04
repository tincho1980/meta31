import { supabase } from './supabase';

/**
 * Local auth mode, for the local API (pnpm dev:local): skips Google login and sends a fixed
 * token the local server accepts. Only possible in `vite dev`: `import.meta.env.DEV` is
 * replaced by `false` in production builds, so this branch is removed from the bundle.
 */
export const localAuth = import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === 'local';

const LOCAL_TOKEN = 'dev-local-token';

/** Bearer token for the Worker, or null if signed out. */
export async function accessToken(): Promise<string | null> {
  if (localAuth) return LOCAL_TOKEN;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
