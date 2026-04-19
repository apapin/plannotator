/**
 * Consume the creator's identity handoff (`&name=&color=`) from the
 * URL fragment written by `handleConfirmStartRoom` on the localhost
 * origin. Cookies and ConfigStore are per-origin, so a creator who
 * configured their displayName/color on localhost has no way to
 * transmit those values to `room.plannotator.ai` except through the
 * URL they navigate to.
 *
 * Responsibilities on success:
 *   - Write into this origin's ConfigStore via `setCustomIdentity` /
 *     `setPresenceColor` so the values persist for future joins too.
 *   - Mark the room as "identity confirmed" when BOTH name and color
 *     arrived validly, so `RoomApp` skips the join gate. Partial
 *     handoffs (abnormal — the Start Room flow writes both) fall back
 *     to the gate so the user can confirm explicitly.
 *   - Strip the params from the visible URL via `replaceState` so a
 *     later copy/paste of the address bar doesn't leak the creator's
 *     name to anyone it was shared with.
 *
 * Path-gated to `/c/:roomId` — non-room shells on the same editor
 * package must not have their static-share fragments rewritten.
 *
 * Extracted from `AppRoot` for testability: the module-load IIFE in
 * `AppRoot` would otherwise run at every test import regardless of
 * intent. Callers set up `window.location.pathname` / `window.location.hash`
 * and invoke this function directly.
 */

import { setCustomIdentity, setPresenceColor } from '@plannotator/ui/utils/identity';
import { isValidPresenceColor } from '@plannotator/ui/utils/presenceColor';
import { markRoomIdentityConfirmed } from '@plannotator/ui/utils/roomIdentityConfirmed';

export function captureCreatorIdentityFromFragment(): void {
  if (typeof window === 'undefined') return;
  const roomMatch = window.location.pathname.match(/^\/c\/([^/]+)$/);
  if (!roomMatch) return;
  const hash = window.location.hash.slice(1);
  if (!hash.includes('name=') && !hash.includes('color=')) return;
  const params = new URLSearchParams(hash);
  const rawName = params.get('name');
  const rawColor = params.get('color');
  let handledName = false;
  let handledColor = false;

  if (rawName) {
    const trimmed = rawName.trim();
    if (trimmed && trimmed.length <= 64) {
      setCustomIdentity(trimmed);
      handledName = true;
    }
  }
  if (rawColor && isValidPresenceColor(rawColor)) {
    setPresenceColor(rawColor);
    handledColor = true;
  }

  // Require BOTH name and color to have landed validly before skipping
  // the join gate. Partial handoffs (abnormal — normal UI always writes
  // both) fall back to the gate so the user can confirm explicitly; the
  // value that did arrive still prefills the relevant field. Without
  // this, a truncated URL or hand-edited fragment could skip the gate
  // using whatever the destination origin had stored from a previous
  // room — creator types "Alice" + picks orange in the modal but lands
  // as "Bob" + orange because Bob was their room-origin cookie from
  // last week.
  if (handledName && handledColor) {
    markRoomIdentityConfirmed(roomMatch[1]);
  }

  params.delete('name');
  params.delete('color');
  const rest = params.toString();
  const pathname = window.location.pathname;
  window.history.replaceState(null, '', `${pathname}${rest ? `#${rest}` : ''}`);
}
