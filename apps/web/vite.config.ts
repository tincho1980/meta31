import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { parse } from 'yaml';

/** Importa archivos .yml como objetos (el glosario de docs/glosario-es.yml). */
function yamlPlugin(): Plugin {
  return {
    name: 'meta31-yaml',
    transform(code, id) {
      if (!id.endsWith('.yml') && !id.endsWith('.yaml')) return null;
      return { code: `export default ${JSON.stringify(parse(code))};`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [
    yamlPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'meta31 · Economía familiar',
        short_name: 'meta31',
        description: 'Planificación económica familiar',
        lang: 'es-AR',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0f766e',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // La API vive en otro origen (workers.dev): no se cachea, siempre va a la red.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
