/**
 * Vite config for the Cloudflare-served live-room editor.
 *
 * Opposite constraints from apps/hook:
 *   - apps/hook: single-file HTML, embedded into a Bun binary that
 *     streams it over a one-shot localhost HTTP server. Uses
 *     vite-plugin-singlefile, inlineDynamicImports, and
 *     assetsInlineLimit=∞ to produce a standalone blob.
 *   - apps/room-service: served by Cloudflare's [assets] binding.
 *     Emits normal chunked output (hashed assets/*.js, *.css).
 *     Wrangler + Cloudflare edge do HTTP/2 multiplexing, Brotli,
 *     per-chunk edge caching, and immutable Cache-Control on hashed
 *     assets. Single-file would defeat all of that.
 *
 * Aliases mirror apps/hook: @plannotator/editor → AppRoot.tsx so the
 * default import is room-mode-aware; @plannotator/editor/App remains
 * available for callers that explicitly want the local shell.
 */

import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from '../../package.json';

export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@plannotator/ui': path.resolve(__dirname, '../../packages/ui'),
      '@plannotator/editor/styles': path.resolve(__dirname, '../../packages/editor/index.css'),
      '@plannotator/editor/App': path.resolve(__dirname, '../../packages/editor/App.tsx'),
      '@plannotator/editor': path.resolve(__dirname, '../../packages/editor/AppRoot.tsx'),
    },
  },
  // Static assets (favicon.svg) are copied verbatim from ./static/ into
  // the build output root. Vite's default publicDir is 'public' but our
  // outDir is also 'public' — using a separate 'static' avoids the
  // "publicDir and outDir overlap" warning.
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: true,
    target: 'esnext',
    // No singlefile, no inlineDynamicImports, no bloated
    // assetsInlineLimit — default Vite chunk shape is what Cloudflare
    // wants. Hashed filenames in assets/ allow indefinite caching with
    // the handler's immutable Cache-Control header.
    rollupOptions: {
      output: {
        // Keep the Vite default naming: [name]-[hash].js under assets/,
        // which the handler's /assets/* passthrough serves verbatim.
      },
    },
  },
  server: {
    // Not used for deploy — just for local `vite` dev if someone wants
    // to iterate on the room UI without Wrangler. The Worker still
    // serves the compiled output.
    port: 3002,
    host: '0.0.0.0',
  },
});
