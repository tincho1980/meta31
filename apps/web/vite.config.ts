import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { parse } from 'yaml';

/** Imports .yml files as objects (the glossary in docs/glosario-es.yml). */
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
        name: 'Meta31',
        short_name: 'Meta31',
        description: 'Llegar al 31 con lo que queda.',
        lang: 'es-AR',
        start_url: '/',
        display: 'standalone',
        background_color: '#FFFDF8', // papel
        theme_color: '#234236', // verde-casa
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The API lives on another origin (workers.dev): never cached, always network.
        navigateFallbackDenylist: [/^\/api\//],
        // brand fonts from Google Fonts, cached for offline use
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts' },
          },
        ],
      },
    }),
  ],
});
