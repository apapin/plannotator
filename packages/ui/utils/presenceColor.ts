/**
 * Pure presence-color helpers — SWATCHES palette, hash-to-swatch
 * defaulter, and validation. No ConfigStore dependency, so this
 * module is safe to import from `packages/ui/config/settings.ts`
 * without creating an import cycle. Store-touching wrappers
 * (getPresenceColor / setPresenceColor) live in `./identity.ts`
 * because presence color is part of the user's identity surface
 * in Live Rooms.
 */

export const PRESENCE_SWATCHES = [
  '#2563eb', '#f97316', '#10b981', '#ef4444',
  '#8b5cf6', '#eab308', '#06b6d4', '#ec4899',
] as const;

export type PresenceSwatch = typeof PRESENCE_SWATCHES[number];

/**
 * Deterministic swatch pick for a given name. First-time users get a
 * distinct default without needing to open the color picker, and two
 * runs of the same identity produce the same color so the creator's
 * self-view matches what peers see.
 */
export function hashNameToSwatch(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % PRESENCE_SWATCHES.length;
  return PRESENCE_SWATCHES[idx];
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** `#RRGGBB` shape check — narrow enough to catch garbage fragment input. */
export function isValidPresenceColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

/** Lowercase-normalize so "#FF0000" and "#ff0000" don't fragment the cookie. */
export function normalizePresenceColor(value: string): string {
  return value.toLowerCase();
}
