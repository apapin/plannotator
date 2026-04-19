/**
 * Tater Identity System
 *
 * Generates anonymous identities for collaborative annotation sharing.
 * Format: {adjective}-{noun}-tater
 * Examples: "swift-falcon-tater", "gentle-crystal-tater"
 *
 * Resolution is delegated to ConfigStore (packages/ui/config/configStore.ts)
 * which handles: server config file > cookie > generated tater name.
 * This module provides the identity-specific API surface.
 *
 * Presence color (Live Rooms) is also stored here because it's part
 * of the user's identity surface: Settings, StartRoomModal, and
 * JoinRoomGate all read/write the same preference, and peer presence
 * carries the self-declared color.
 */

import { configStore } from '../config';
import { generateIdentity } from './generateIdentity';
import { hashNameToSwatch, normalizePresenceColor } from './presenceColor';

/**
 * Get current identity from ConfigStore.
 */
export function getIdentity(): string {
  return configStore.get('displayName');
}

/**
 * Set a custom display name.
 * Writes to cookie (sync) + queues server write-back (async) via ConfigStore.
 */
export function setCustomIdentity(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return getIdentity(); // reject empty
  configStore.set('displayName', trimmed);
  return trimmed;
}

/**
 * Regenerate identity with a new random tater name AND a matching
 * hash-derived presence color. Couples name and color on purpose:
 * `presenceColor`'s default factory only runs on first-ever visit
 * (cookie empty), so without this link, clicking "Regenerate" in
 * Settings cycles the name but keeps the original color forever —
 * users hit this as "my color never changes no matter what I try."
 *
 * The color stays deterministic per name (same tater = same swatch
 * across sessions / machines, which helps teammates recognize each
 * other). Users who want a specific color can still override via
 * the Settings swatch row — that writes `presenceColor` directly
 * and persists.
 */
export function regenerateIdentity(): string {
  const identity = generateIdentity();
  configStore.set('displayName', identity);
  configStore.set('presenceColor', hashNameToSwatch(identity));
  return identity;
}

/**
 * Check if an identity belongs to the current user.
 */
export function isCurrentUser(author: string | undefined): boolean {
  if (!author) return false;
  return author === configStore.get('displayName');
}

/** Get current presence color. */
export function getPresenceColor(): string {
  return configStore.get('presenceColor');
}

/**
 * Persist a new presence color. Normalized to lowercase so "#FF0000"
 * and "#ff0000" don't produce separate cookie values across surfaces.
 */
export function setPresenceColor(color: string): string {
  const normalized = normalizePresenceColor(color);
  configStore.set('presenceColor', normalized);
  return normalized;
}
