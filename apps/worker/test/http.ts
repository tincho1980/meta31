// Test harness: the real Hono app over a PGlite database, with requests signed as a seeded user.
import type { TestDb } from '@meta31/db/testing';
import { createMiddleware } from 'hono/factory';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import type { AppEnv, Bindings } from '../src/env.js';
import { createTokenVerifier } from '../src/middleware/auth.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

export const testEnv: Bindings = {
  HYPERDRIVE: { connectionString: 'unused-in-tests' },
  SUPABASE_URL,
  ALLOWED_ORIGINS: 'http://localhost:5173',
};

export type Client = {
  get: (path: string) => Promise<Response>;
  post: (path: string, body: unknown) => Promise<Response>;
  patch: (path: string, body: unknown) => Promise<Response>;
  delete: (path: string) => Promise<Response>;
  put: (path: string, body: unknown) => Promise<Response>;
  /** A fetch into the app with the token (e.g. for the MCP client transport). */
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

/** App wired to `t.db`, plus a client that sends a valid token for `email`. */
export async function createHttpClient(t: TestDb, email = 'martin@example.com'): Promise<Client> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  const verifier = createTokenVerifier({ issuer: ISSUER, jwks: createLocalJWKSet({ keys: [jwk] }) });
  const db = createMiddleware<AppEnv>(async (c, next) => {
    c.set('db', t.db);
    await next();
  });
  const app = createApp({ db, verifier: () => verifier });
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setExpirationTime('1h')
    .sign(privateKey);
  const send = async (method: string, path: string, body?: unknown): Promise<Response> =>
    app.request(
      path,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      testEnv,
    );
  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path) => send('DELETE', path),
    put: (path, body) => send('PUT', path, body),
    fetch: async (input, init) => {
      const req = new Request(input, init);
      req.headers.set('Authorization', `Bearer ${token}`);
      return app.request(req, undefined, testEnv);
    },
  };
}
