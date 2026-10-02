import { findUserByEmail } from '@meta31/db';
import { createMiddleware } from 'hono/factory';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from 'jose';
import type { AppEnv, Bindings } from '../env.js';

/** Verifica la firma y los claims de un JWT y devuelve su payload; si no es válido, lanza. */
export type TokenVerifier = (token: string) => Promise<JWTPayload>;

type VerifierOptions = {
  issuer: string;
  /** Claves públicas (JWKS) para tokens asimétricos (ES256/RS256). */
  jwks: JWTVerifyGetKey;
  /** Secreto HS256 legado, si el proyecto todavía lo usa. */
  hsSecret?: string | undefined;
};

export function createTokenVerifier({ issuer, jwks, hsSecret }: VerifierOptions): TokenVerifier {
  const secret = hsSecret ? new TextEncoder().encode(hsSecret) : undefined;
  const claims = { issuer, audience: 'authenticated' };
  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    if (alg === 'HS256') {
      if (!secret) throw new Error('Token HS256 sin secreto configurado');
      return (await jwtVerify(token, secret, { ...claims, algorithms: ['HS256'] })).payload;
    }
    return (await jwtVerify(token, jwks, { ...claims, algorithms: ['ES256', 'RS256'] })).payload;
  };
}

// El JWKS se cachea por isolate: son claves públicas, no conexiones.
const jwksByUrl = new Map<string, JWTVerifyGetKey>();

/** Verificador contra el proyecto Supabase configurado en el Worker. */
export function supabaseVerifier(env: Bindings): TokenVerifier {
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  let jwks = jwksByUrl.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksByUrl.set(jwksUrl, jwks);
  }
  return createTokenVerifier({ issuer, jwks, hsSecret: env.SUPABASE_JWT_SECRET });
}

/**
 * Middleware único de autenticación (RNF-07):
 * - sin token, o token inválido o vencido → 401
 * - token válido pero mail fuera de la lista blanca (person.is_user) → 403
 */
export function auth(getVerifier: (env: Bindings) => TokenVerifier) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return c.json({ error: 'unauthorized' }, 401);

    let payload: JWTPayload;
    try {
      payload = await getVerifier(c.env)(token);
    } catch {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const email = typeof payload.email === 'string' ? payload.email : null;
    if (!email) return c.json({ error: 'forbidden' }, 403);

    const user = await findUserByEmail(c.var.db, email);
    if (!user) return c.json({ error: 'forbidden' }, 403);

    c.set('user', user);
    await next();
  });
}
