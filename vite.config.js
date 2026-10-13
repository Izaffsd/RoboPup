import { defineConfig } from 'vite';

/**
 * Vite is used for development and production bundling only.
 *
 * - Hashed JS/CSS bundles go to `dist/bundle/` so they never collide with the
 *   unhashed game data that lives in `public/assets/` (served as `/assets/`).
 * - three.js and Rapier are split into their own long-lived vendor chunks so a
 *   gameplay code change does not invalidate the (large) engine downloads.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsDir: 'bundle',
    sourcemap: false,
    // @dimforge/rapier3d-compat inlines its WASM as base64 (~4.3 MB raw,
    // ~1.7 MB gzipped) by design; everything else stays well below this.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-rapier', test: /node_modules[\\/]@dimforge/, priority: 20 },
            { name: 'vendor-three', test: /node_modules[\\/]three/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
