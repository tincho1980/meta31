import { seedPeople } from '@meta31/db';
import { createTestDb, type TestDb } from '@meta31/db/testing';
import { createMiddleware } from 'hono/factory';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppEnv, Bindings } from '../src/env.js';
import { createTokenVerifier } from '../src/middleware/auth.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const HS_SECRET = 'legacy-test-secret-that-is-long-enough';

const env: Bindings = {
  HYPERDRIVE: { connectionString: 'unused-in-tests' },
  SUPABASE_URL,
  ALLOWED_ORIGINS: 'http://localhost:5173',
};

let t: TestDb;
let app: ReturnType<typeof createApp>;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  t = await createTestDb();
  await seedPeople(t.db, { martin: 'martin@example.com', rosalia: 'rosalia@example.com' });

  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('ES256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
  const verifier = createTokenVerifier({
    issuer: ISSUER,
    jwks: createLocalJWKSet({ keys: [jwk] }),
    hsSecret: HS_SECRET,
  });

  const testDb = createMiddleware<AppEnv>(async (c, next) => {
    c.set('db', t.db);
    await next();
  });
  app = createApp({ db: testDb, verifier: () => verifier });
});

afterAll(async () => {
  await t.close();
});

type TokenOptions = {
  claims?: JWTPayload;
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
  key?: CryptoKey | Uint8Array;
  alg?: string;
};

async function token(opts: TokenOptions = {}) {
  const alg = opts.alg ?? 'ES256';
  return new SignJWT({ email: 'martin@example.com', ...opts.claims })
    .setProtectedHeader({ alg, kid: 'k1' })
    .setSubject('user-1')
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(opts.key ?? privateKey);
}

function getMe(authorization?: string) {
  const headers: Record<string, string> = authorization ? { Authorization: authorization } : {};
  return app.request('/api/me', { headers }, env);
}

describe('auth middleware', () => {
  it('valid token of an allowlisted user → 200 with their name read from person', async () => {
    const res = await getMe(`Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Martín', email: 'martin@example.com' });
  });

  it('email comparison is case-insensitive', async () => {
    const res = await getMe(`Bearer ${await token({ claims: { email: 'Rosalia@Example.COM' } })}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Rosalía' });
  });

  it('expired token → 401', async () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    const res = await getMe(`Bearer ${await token({ expiresIn: expired })}`);
    expect(res.status).toBe(401);
  });

  it('email not in the allowlist → 403', async () => {
    const res = await getMe(`Bearer ${await token({ claims: { email: 'intruder@example.com' } })}`);
    expect(res.status).toBe(403);
  });

  it('valid token without an email claim → 403', async () => {
    const res = await getMe(`Bearer ${await token({ claims: { email: undefined } })}`);
    expect(res.status).toBe(403);
  });

  it('no Authorization header → 401', async () => {
    expect((await getMe()).status).toBe(401);
    expect((await getMe('Basic abc')).status).toBe(401);
  });

  it('signed with another key → 401', async () => {
    const res = await getMe(`Bearer ${await token({ key: otherPrivateKey })}`);
    expect(res.status).toBe(401);
  });

  it('issuer or audience of another project → 401', async () => {
    const otherIssuer = await token({ issuer: 'https://other.supabase.co/auth/v1' });
    const otherAudience = await token({ audience: 'anon' });
    expect((await getMe(`Bearer ${otherIssuer}`)).status).toBe(401);
    expect((await getMe(`Bearer ${otherAudience}`)).status).toBe(401);
  });

  it('garbage token → 401', async () => {
    expect((await getMe('Bearer not.a.jwt')).status).toBe(401);
  });

  it('accepts the legacy HS256 secret when configured', async () => {
    const key = new TextEncoder().encode(HS_SECRET);
    const res = await getMe(`Bearer ${await token({ alg: 'HS256', key })}`);
    expect(res.status).toBe(200);
  });

  it('HS256 signed with another secret → 401', async () => {
    const key = new TextEncoder().encode('another-secret-not-the-project-one!!!!!');
    const res = await getMe(`Bearer ${await token({ alg: 'HS256', key })}`);
    expect(res.status).toBe(401);
  });

  it('HS256 without a configured secret → 401', async () => {
    const pair = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
    const noSecret = createTokenVerifier({ issuer: ISSUER, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const key = new TextEncoder().encode(HS_SECRET);
    await expect(noSecret(await token({ alg: 'HS256', key }))).rejects.toThrow();
  });
});

describe('CORS', () => {
  it('allows only the configured origins', async () => {
    const preflight = (origin: string) =>
      app.request(
        '/api/me',
        {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
        },
        env,
      );
    const ok = await preflight('http://localhost:5173');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const bad = await preflight('https://malicious.example');
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
