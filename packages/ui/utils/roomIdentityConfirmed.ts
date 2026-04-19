/**
 * Per-room "identity was confirmed in this tab" flag.
 *
 * Lives in sessionStorage (dies on tab close, survives reload) and is
 * keyed per roomId. Two writers:
 *   - `AppRoot` after consuming a creator identity handoff from the URL
 *     fragment (creator already confirmed locally before navigating).
 *   - `RoomApp.handleJoin` after the participant submits the gate.
 *
 * Consumer: `RoomApp` reads this on mount to decide whether to skip
 * `JoinRoomGate`. A set flag for the current roomId means "we already
 * have a confirmed identity for this specific room in this tab" —
 * reload preserves it; opening a different room URL does not, so the
 * user gets a prefilled gate again for the new room (per-room scoping
 * matches the agreed UX: confirm once per room, reuse on reload).
 */

const KEY_PREFIX = 'plannotator.room.identity-confirmed.';

function storageKey(roomId: string): string {
  return `${KEY_PREFIX}${roomId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function markRoomIdentityConfirmed(roomId: string): void {
  const s = getStorage();
  if (!s) return;
  try {
    s.setItem(storageKey(roomId), '1');
  } catch {
    // Quota / disabled — the worst case is the user sees the gate again
    // on reload. Not worth bubbling.
  }
}

export function isRoomIdentityConfirmed(roomId: string): boolean {
  const s = getStorage();
  if (!s) return false;
  try {
    return s.getItem(storageKey(roomId)) !== null;
  } catch {
    return false;
  }
}
