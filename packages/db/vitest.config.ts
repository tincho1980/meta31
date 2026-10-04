import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    environment: 'node',
    // tests boot PGlite and apply the migrations: with every package running in parallel
    // that can exceed the 10 s default
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
