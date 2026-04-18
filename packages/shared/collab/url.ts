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
import { ROOM_SECRET_LENGTH_BYTES } from './constants';

const DEFAULT_BASE_URL = 'https://room.plannotator.ai';

export interface ParsedRoomUrl {
  roomId: string;
  roomSecret: Uint8Array;
}

/**
 * Parse a room join URL. Extracts roomId and roomSecret from the fragment.
 * Returns null if the URL is malformed, missing a fragment, or not a valid room URL.
 *
 * Expected format: https://room.plannotator.ai/c/<roomId>#key=<base64url-roomSecret>
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

    return { roomId, roomSecret };
  } catch {
    return null;
  }
}

/**
 * Construct a room join URL with the secret in the fragment.
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
  return `${baseUrl}/c/${roomId}#key=${bytesToBase64url(roomSecret)}`;
}
