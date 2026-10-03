import { defineProject } from 'vitest/config';

// Los tests corren en Node contra PGlite: la app de Hono se prueba con app.request().
export default defineProject({
  test: {
    name: 'worker',
    environment: 'node',
  },
});
