/**
 * Detect whether the editor is running in live-room mode, local mode, or
 * a broken-room-link state that must NOT fall through to local mode.
 *
 * Three-way return:
 *   - `{ mode: 'room', roomId, url }`: the URL is `/c/<roomId>` AND
 *     parseRoomUrl succeeds (valid 32-byte roomSecret in the fragment).
 *   - `{ mode: 'invalid-room', reason }`: the URL is a room-shaped path
 *     (`/c/...` or any `/c/*` variant) but parseRoomUrl fails — missing
 *     fragment, malformed key, invalid base64url encoding, or extra path
 *     segments. Note: parseRoomUrl does NOT enforce the server's 22-char
 *     base64url roomId contract (see validation.ts `isRoomId`); the
 *     server rejects invalid roomIds at the WebSocket upgrade step
 *     before the client even authenticates. AppRoot renders a terminal
 *     error instead of booting
 *     the local editor. This closes the "public room origin boots local
 *     app on a broken link" loophole — a user landing on
 *     room.plannotator.ai/c/<foo> with no #key should see "this link
 *     looks broken", not the full local editor with no plan.
 *   - `{ mode: 'local' }`: everything else (bare `/`, `/about`, etc.).
 *     Callers that are sure the origin is room-only (i.e., Cloudflare
 *     deployment) can ignore this branch; AppRoot still renders it for
 *     dev/test scenarios where the room bundle gets loaded at `/`.
 *
 * Parses once on mount. Mode transitions require a full reload — the
 * two shells own substantially different state machines.
 *
 * SSR-safe: returns local mode if `window` is undefined.
 */

import { useState } from 'react';
import { parseRoomUrl } from '@plannotator/shared/collab/client';

export type RoomMode =
  | { mode: 'local' }
  | { mode: 'room'; roomId: string; url: string }
  | { mode: 'invalid-room'; reason: string };

const ROOM_PATH_RE = /^\/c(\/|$)/;

export function useRoomMode(): RoomMode {
  const [value] = useState<RoomMode>(() => {
    if (typeof window === 'undefined') return { mode: 'local' };

    const href = window.location.href;
    const pathname = window.location.pathname;

    // Path doesn't look room-shaped at all → local mode.
    if (!ROOM_PATH_RE.test(pathname)) {
      return { mode: 'local' };
    }

    // Path starts with /c/ — it's claiming to be a room URL. From here
    // every failure is an 'invalid-room' (NOT a silent fallthrough to
    // local), so a public room origin never renders the full local
    // editor for malformed inputs.
    const parsed = parseRoomUrl(href);
    if (!parsed) {
      return {
        mode: 'invalid-room',
        reason:
          'This room link is missing or malformed. Check that the URL includes a valid #key= fragment.',
      };
    }
    return { mode: 'room', roomId: parsed.roomId, url: href };
  });
  return value;
}
