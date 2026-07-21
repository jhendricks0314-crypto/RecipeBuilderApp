import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// RAIning Recipes build config.
// The PWA plugin gives us: installability (manifest), offline shell, and
// automatic updates. `registerType: 'autoUpdate'` means a new service worker
// is fetched in the background and the app updates itself on next load; the
// in-app UpdatePrompt also lets the user reload immediately.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/favicon-96.png', 'icons/apple-touch-icon.png'],
      manifest: {
        // An explicit, stable id. Chrome keys an installed app by this; it
        // defaults to start_url, so '/' matches existing installs and keeps
        // the update path intact for anyone who already installed the app.
        id: '/',
        name: 'RAIning Recipes — plan, cook, spend smart',
        short_name: 'RAIning Recipes',
        description:
          'Generate recipes with AI, build budget shopping lists, and turn scanned receipts into real prices.',
        theme_color: '#16231c',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/\.netlify\//],
        runtimeCaching: [
          {
            // Never cache API calls — always hit the network so data is fresh.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') ||
              url.pathname.startsWith('/.netlify/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
})
