/**
 * AppRoot — the top-level fork that picks between local mode (<App />) and
 * room mode (<RoomApp><App roomSession=… /></RoomApp>).
 *
 * This is the *only* place that knows whether the editor is in a live
 * room. Everything below reacts to a single `roomSession` prop; the
 * Viewer, annotation panel, toolbar, and share UI stay mode-oblivious.
 *
 * `@plannotator/editor` re-exports this as its default so apps/hook/,
 * apps/portal/, and any other consumer automatically pick up room-mode
 * support by upgrading.
 */

import React from 'react';
import App from './App';
import { RoomApp } from './RoomApp';
import { useRoomMode } from '@plannotator/ui/hooks/useRoomMode';
import { isBase64Url32ByteString } from '@plannotator/shared/collab/validation';
import { storeAdminSecret, loadAdminSecret } from '@plannotator/ui/utils/adminSecretStorage';
import { captureCreatorIdentityFromFragment } from './roomIdentityHandoff';

/**
 * Capture the image-strip handoff written by the creator into the
 * fragment (`&stripped=N`) and strip the param from the visible URL so
 * a refresh doesn't re-show the notice. The count itself is picked up
 * by RoomApp via `window.__PLANNOTATOR_STRIPPED_IMAGES__`.
 *
 * Path-gated to `/c/:roomId`: non-room shells (apps/hook, apps/portal,
 * apps/review) also mount `AppRoot`, and their URL fragments are static-
 * share payloads — feeding those through `URLSearchParams` and rewriting
 * with `history.replaceState` corrupts the deflated share hash. Only room
 * URLs carry `&stripped=N`, so scope the rewrite to room paths.
 */
function extractStrippedImagesFromFragment(): void {
  if (typeof window === 'undefined') return;
  if (!/^\/c\/([^/]+)$/.test(window.location.pathname)) return;
  const hash = window.location.hash.slice(1);
  if (!hash.includes('stripped=')) return;
  const params = new URLSearchParams(hash);
  const strippedRaw = params.get('stripped');
  if (strippedRaw) {
    const n = parseInt(strippedRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      (window as { __PLANNOTATOR_STRIPPED_IMAGES__?: number }).__PLANNOTATOR_STRIPPED_IMAGES__ = n;
    }
  }
  params.delete('stripped');
  const rest = params.toString();
  const pathname = window.location.pathname;
  window.history.replaceState(null, '', `${pathname}${rest ? `#${rest}` : ''}`);
}

/**
 * Capture the admin secret from the URL fragment into sessionStorage at
 * this origin so refresh recovers admin capability even if the fragment
 * later gets stripped (e.g. by a URL cleaner, paste-and-reload, or a
 * future `replaceState` that drops the admin param).
 *
 * We do NOT strip the admin fragment from the visible URL — useCollabRoom
 * still needs it for WebSocket auth on every connection, and stripping
 * would break refresh unless we also wired an adminSecret override into
 * useRoomMode → RoomApp. sessionStorage is best-effort recovery; the
 * fragment remains the canonical credential carrier.
 */
function captureAdminSecretFromFragment(): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  const roomMatch = path.match(/^\/c\/([^/]+)$/);
  if (!roomMatch) return;
  const hash = window.location.hash.slice(1);
  if (!hash.includes('admin=')) return;
  const params = new URLSearchParams(hash);
  const admin = params.get('admin');
  if (!admin) return;
  // Validate before storing: a crafted URL with a garbage admin= value
  // would poison this room's sessionStorage entry and cause join/admin
  // recovery failures on later visits until the entry is cleared.
  // ADMIN_SECRET_LENGTH_BYTES is 32; base64url of 32 bytes is 43 chars.
  // We validate length + charset rather than importing the full crypto
  // module at boot time.
  if (!isBase64Url32ByteString(admin)) return;
  // No-clobber: if we already have a stored admin secret for this
  // room, only accept a matching value. A fake-but-well-shaped
  // `&admin=` appended to the participant URL (room key is already
  // public via the participant link) could otherwise overwrite the
  // creator's real stored secret, breaking refresh-based admin
  // recovery until sessionStorage is cleared manually. Same admin
  // secret is idempotent; a different one is silently ignored.
  const existing = loadAdminSecret(roomMatch[1]);
  if (existing && existing !== admin) return;
  storeAdminSecret(roomMatch[1], admin);
}

// Module-level side effects so they run exactly once per tab load, before
// React mounts anything. `captureCreatorIdentityFromFragment` is imported
// from `./roomIdentityHandoff` for test isolation — running it alongside
// the two legacy captures above keeps the visible URL and ConfigStore in
// sync for the creator-origin → room-origin navigation.
extractStrippedImagesFromFragment();
captureAdminSecretFromFragment();
captureCreatorIdentityFromFragment();

export function AppRoot(): React.ReactElement {
  const mode = useRoomMode();

  if (mode.mode === 'local') {
    return <App />;
  }

  if (mode.mode === 'invalid-room') {
    // A path under /c/ that failed to parse must NOT fall through to
    // the local editor. On the public room origin this prevents
    // visitors to room.plannotator.ai/c/<bad> from seeing a blank
    // local Plannotator with no plan context. We render a terminal
    // dead-end advising the user to request a fresh link. Same shape
    // RoomApp uses for room-deleted/room-expired.
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-3 max-w-sm">
          <h2 className="text-lg font-semibold">This room link looks broken</h2>
          <p className="text-sm text-muted-foreground">{mode.reason}</p>
          <p className="text-xs text-muted-foreground">
            Ask the person who shared this link to send it again.
          </p>
        </div>
      </div>
    );
  }

  // Room mode. RoomApp owns the session and renders the editor via
  // the renderEditor prop with roomSession threaded through.
  return (
    <RoomApp
      roomId={mode.roomId}
      url={mode.url}
      originatedLocally={false}
      renderEditor={({ roomSession }) => <App roomSession={roomSession} />}
    />
  );
}

export default AppRoot;
