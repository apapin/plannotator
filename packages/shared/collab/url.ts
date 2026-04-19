/**
 * @module CLIENT-ONLY
 *
 * Room URL parsing and construction for browser and direct-agent clients.
 *
 * The Worker and Durable Object must NEVER import this module.
 * They never receive URL fragments and must not parse full room URLs.
 * They receive only roomId via /api/rooms request bodies or /ws/<roomId>
 * routes, plus verifiers/proofs in request or WebSocket message bodies.
 */

import { bytesToBase64url, base64urlToBytes } from './encoding';
import { ADMIN_SECRET_LENGTH_BYTES, ROOM_SECRET_LENGTH_BYTES } from './constants';

const DEFAULT_BASE_URL = 'https://room.plannotator.ai';

/** Strip a single trailing slash from a base URL so path concatenation is safe. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export interface ParsedRoomUrl {
  roomId: string;
  roomSecret: Uint8Array;
  /** Present only if the URL fragment includes `&admin=...` (creator/recovery URLs). */
  adminSecret?: Uint8Array;
}

/**
 * Parse a room join URL. Extracts roomId, roomSecret, and optional adminSecret.
 * Returns null if the URL is malformed.
 *
 * Expected formats:
 *   https://room.plannotator.ai/c/<roomId>#key=<base64url-roomSecret>
 *   https://room.plannotator.ai/c/<roomId>#key=<base64url-roomSecret>&admin=<base64url-adminSecret>
 *
 * If `admin=` is present but malformed (wrong length, bad encoding), returns null.
 */
export function parseRoomUrl(url: string): ParsedRoomUrl | null {
  try {
    const parsed = new URL(url);

    // Extract roomId from pathname /c/<roomId>
    const match = parsed.pathname.match(/^\/c\/([^/]+)$/);
    if (!match) return null;

    const roomId = match[1];
    if (!roomId) return null;

    // Extract key from fragment
    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (!hash) return null;

    const params = new URLSearchParams(hash);
    const keyParam = params.get('key');
    if (!keyParam) return null;

    const roomSecret = base64urlToBytes(keyParam);
    if (roomSecret.length !== ROOM_SECRET_LENGTH_BYTES) return null;

    const result: ParsedRoomUrl = { roomId, roomSecret };

    // Optional admin capability
    const adminParam = params.get('admin');
    if (adminParam !== null) {
      const adminSecret = base64urlToBytes(adminParam);
      if (adminSecret.length !== ADMIN_SECRET_LENGTH_BYTES) return null;
      result.adminSecret = adminSecret;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Construct a #key-only room join URL (safe to share with participants).
 *
 * @param roomId - The room identifier
 * @param roomSecret - The 256-bit room secret (raw bytes)
 * @param baseUrl - Base URL (defaults to "https://room.plannotator.ai")
 */
export function buildRoomJoinUrl(
  roomId: string,
  roomSecret: Uint8Array,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  if (roomSecret.length !== ROOM_SECRET_LENGTH_BYTES) {
    throw new Error(`Invalid room secret: expected ${ROOM_SECRET_LENGTH_BYTES} bytes`);
  }
  return `${normalizeBaseUrl(baseUrl)}/c/${roomId}#key=${bytesToBase64url(roomSecret)}`;
}

/**
 * Construct a room URL that includes admin capability (creator-only / recovery).
 *
 * WARNING: adminUrl grants lock/unlock/delete capability. It must NOT be the
 * default share target. Use `buildRoomJoinUrl()` for normal participant sharing.
 */
export function buildAdminRoomUrl(
  roomId: string,
  roomSecret: Uint8Array,
  adminSecret: Uint8Array,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  if (roomSecret.length !== ROOM_SECRET_LENGTH_BYTES) {
    throw new Error(`Invalid room secret: expected ${ROOM_SECRET_LENGTH_BYTES} bytes`);
  }
  if (adminSecret.length !== ADMIN_SECRET_LENGTH_BYTES) {
    throw new Error(`Invalid admin secret: expected ${ADMIN_SECRET_LENGTH_BYTES} bytes`);
  }
  return `${normalizeBaseUrl(baseUrl)}/c/${roomId}#key=${bytesToBase64url(roomSecret)}&admin=${bytesToBase64url(adminSecret)}`;
}
