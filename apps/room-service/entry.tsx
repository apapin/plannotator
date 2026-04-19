/**
 * Browser entry for the live-room Plannotator editor served at
 * room.plannotator.ai/c/:roomId.
 *
 * AppRoot parses the URL via useRoomMode() and picks between <App />
 * (local mode — never reached on this origin by design) and
 * <RoomApp><App roomSession={...} /></RoomApp>. The same bundle would
 * fall back to local mode on any non-room URL, but Cloudflare's Worker
 * only routes /c/:roomId to this HTML, so room mode is the expected
 * entry point.
 *
 * Unlike apps/hook (the local CLI-served binary, built with
 * vite-plugin-singlefile so it can be embedded into a one-shot HTTP
 * server), this build emits chunked assets. The Worker's `[assets]`
 * binding + Cloudflare edge serves them with HTTP/2 multiplexing and
 * per-chunk Brotli, so cold-start transfer is smaller than a singlefile
 * blob and warm visits rehit cached hashed chunks.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from '@plannotator/editor';
// @ts-expect-error — Vite resolves CSS side-effect imports at build time;
// there is no .d.ts for the index.css file and adding one would not match
// the existing apps/hook pattern. TypeScript doesn't need to analyze it.
import '@plannotator/editor/styles';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Plannotator entry: #root element missing from index.html');
}
createRoot(root).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
);
