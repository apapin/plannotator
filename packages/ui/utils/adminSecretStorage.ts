/**
 * Admin secret persistence for room creators.
 *
 * Scope: sessionStorage, keyed per roomId (`plannotator.room.admin.<roomId>`).
 * Survives tab refresh, dies on tab close. Deliberately NOT localStorage —
 * the adminSecret is a URL-fragment-grade credential; long-term persistence
 * would outlive the user's intent. Deliberately NOT in-memory only — the
 * creator must be able to refresh their tab without losing admin capability.
 *
 * Threat model: anything that can read sessionStorage in this origin already
 * controls the tab. The adminSecret grants lock/unlock/delete on one specific
 * room; leaking it out of sessionStorage would only happen via XSS in the
 * same origin, at which point the attacker already has full control.
 *
 * Values are stored as base64url strings so a caller consuming
 * `loadAdminSecret()` decodes the same format `parseRoomUrl()` produces from
 * the fragment. The read path validates the shape on load and evicts
 * malformed entries so downstream admin-join paths never see garbage.
 */

import { isBase64Url32ByteString } from '@plannotator/shared/collab/validation';

const KEY_PREFIX = 'plannotator.room.admin.';

function storageKey(roomId: string): string {
  return `${KEY_PREFIX}${roomId}`;
}

/** Best-effort sessionStorage access — returns null if unavailable (SSR, sandboxed iframe). */
function getStorage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    // Probe for quota / disabled storage without throwing.
    const probeKey = `${KEY_PREFIX}__probe__`;
    sessionStorage.setItem(probeKey, '1');
    sessionStorage.removeItem(probeKey);
    return sessionStorage;
  } catch {
    return null;
  }
}

export function storeAdminSecret(roomId: string, adminSecretBase64url: string): void {
  const s = getStorage();
  if (!s) return;
  try {
    s.setItem(storageKey(roomId), adminSecretBase64url);
  } catch {
    // Quota / disabled — silently give up. The caller should degrade to
    // "admin capability will be lost on refresh" rather than failing.
  }
}

export function loadAdminSecret(roomId: string): string | null {
  const s = getStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(storageKey(roomId));
    if (raw === null) return null;
    if (!isBase64Url32ByteString(raw)) {
      // Evict so a bad value doesn't live on across reloads and so callers
      // that key off "has stored secret?" don't attempt to recover admin
      // capability from garbage.
      try { s.removeItem(storageKey(roomId)); } catch { /* ignore */ }
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function clearAdminSecret(roomId: string): void {
  const s = getStorage();
  if (!s) return;
  try {
    s.removeItem(storageKey(roomId));
  } catch {
    // ignore
  }
}
