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
const HS_SECRET = 'secreto-legado-de-prueba-con-largo-suficiente';

const env: Bindings = {
  HYPERDRIVE: { connectionString: 'no-se-usa-en-tests' },
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

describe('middleware de auth', () => {
  it('token válido de un usuario de la lista → 200 con su nombre leído de person', async () => {
    const res = await getMe(`Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Martín', email: 'martin@example.com' });
  });

  it('el mail se compara sin mayúsculas', async () => {
    const res = await getMe(`Bearer ${await token({ claims: { email: 'Rosalia@Example.COM' } })}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Rosalía' });
  });

  it('token vencido → 401', async () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    const res = await getMe(`Bearer ${await token({ expiresIn: expired })}`);
    expect(res.status).toBe(401);
  });

  it('mail fuera de la lista blanca → 403', async () => {
    const res = await getMe(`Bearer ${await token({ claims: { email: 'intruso@example.com' } })}`);
    expect(res.status).toBe(403);
  });

  it('token válido sin claim de mail → 403', async () => {
    const res = await getMe(`Bearer ${await token({ claims: { email: undefined } })}`);
    expect(res.status).toBe(403);
  });

  it('sin header Authorization → 401', async () => {
    expect((await getMe()).status).toBe(401);
    expect((await getMe('Basic abc')).status).toBe(401);
  });

  it('firma con otra clave → 401', async () => {
    const res = await getMe(`Bearer ${await token({ key: otherPrivateKey })}`);
    expect(res.status).toBe(401);
  });

  it('issuer o audiencia de otro proyecto → 401', async () => {
    const otherIssuer = await token({ issuer: 'https://otro.supabase.co/auth/v1' });
    const otherAudience = await token({ audience: 'anon' });
    expect((await getMe(`Bearer ${otherIssuer}`)).status).toBe(401);
    expect((await getMe(`Bearer ${otherAudience}`)).status).toBe(401);
  });

  it('token basura → 401', async () => {
    expect((await getMe('Bearer no.es.un-jwt')).status).toBe(401);
  });

  it('acepta el secreto HS256 legado si está configurado', async () => {
    const key = new TextEncoder().encode(HS_SECRET);
    const res = await getMe(`Bearer ${await token({ alg: 'HS256', key })}`);
    expect(res.status).toBe(200);
  });

  it('HS256 firmado con otro secreto → 401', async () => {
    const key = new TextEncoder().encode('otro-secreto-que-no-es-el-del-proyecto!!');
    const res = await getMe(`Bearer ${await token({ alg: 'HS256', key })}`);
    expect(res.status).toBe(401);
  });

  it('HS256 sin secreto configurado → 401', async () => {
    const pair = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
    const noSecret = createTokenVerifier({ issuer: ISSUER, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const key = new TextEncoder().encode(HS_SECRET);
    await expect(noSecret(await token({ alg: 'HS256', key }))).rejects.toThrow();
  });
});

describe('CORS', () => {
  it('habilita solo los orígenes configurados', async () => {
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
    const bad = await preflight('https://malicioso.example');
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
