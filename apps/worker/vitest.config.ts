import { defineProject } from 'vitest/config';

// Tests run in Node against PGlite: the Hono app is exercised with app.request().
export default defineProject({
  test: {
    name: 'worker',
    environment: 'node',
    // every test boots its own PGlite and applies the migrations: under load (dev servers,
    // all packages in parallel) that can exceed the 10 s default
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
