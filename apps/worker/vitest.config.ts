import { defineProject } from 'vitest/config';

// Tests run in Node against PGlite: the Hono app is exercised with app.request().
export default defineProject({
  test: {
    name: 'worker',
    environment: 'node',
  },
});
