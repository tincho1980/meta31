import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Bindings } from './env.js';
import { auth, type TokenVerifier } from './middleware/auth.js';
import { me } from './routes/me.js';

export type AppDeps = {
  /** Deja `c.var.db` listo. En producción: Hyperdrive; en tests: PGlite. */
  db: MiddlewareHandler<AppEnv>;
  verifier: (env: Bindings) => TokenVerifier;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => {
        // cors() tipa el contexto sin nuestros bindings
        const allowed = (c.env as Bindings).ALLOWED_ORIGINS.split(',').map((o) => o.trim());
        return allowed.includes(origin) ? origin : null;
      },
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    }),
  );
  app.use('/api/*', deps.db);
  app.use('/api/*', auth(deps.verifier));

  app.route('/api/me', me);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
