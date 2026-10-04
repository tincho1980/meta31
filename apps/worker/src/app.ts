import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Bindings } from './env.js';
import { auth, type TokenVerifier } from './middleware/auth.js';
import { installmentPurchases, subscriptions } from './routes/card-items.js';
import { categories } from './routes/categories.js';
import { creditCards } from './routes/credit-cards.js';
import { exchangeRates } from './routes/exchange-rates.js';
import { incomeSources } from './routes/income-sources.js';
import { loans } from './routes/loans.js';
import { me } from './routes/me.js';
import { oneOffExpenses } from './routes/one-off-expenses.js';
import { people } from './routes/people.js';
import { properties } from './routes/properties.js';
import { recurringExpenses } from './routes/recurring-expenses.js';
import { ServiceError } from './services/errors.js';

export type AppDeps = {
  /** Sets `c.var.db`. Production: Hyperdrive; tests: PGlite. */
  db: MiddlewareHandler<AppEnv>;
  verifier: (env: Bindings) => TokenVerifier;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => {
        // cors() types the context without our bindings
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
  app.route('/api/categories', categories);
  app.route('/api/exchange-rates', exchangeRates);
  app.route('/api/people', people);
  app.route('/api/properties', properties);
  app.route('/api/income-sources', incomeSources);
  app.route('/api/recurring-expenses', recurringExpenses);
  app.route('/api/one-off-expenses', oneOffExpenses);
  app.route('/api/credit-cards', creditCards);
  app.route('/api/installment-purchases', installmentPurchases);
  app.route('/api/subscriptions', subscriptions);
  app.route('/api/loans', loans);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    if (err instanceof ServiceError) {
      return c.json({ error: err.code, ...(err.reason ? { reason: err.reason } : {}) }, err.code === 'not_found' ? 404 : 409);
    }
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
