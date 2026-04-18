/**
 * High-entropy ID and secret generation for room protocol.
 *
 * All functions use crypto.getRandomValues() — portable across
 * browsers, Bun, and Cloudflare Workers.
 */

import { bytesToBase64url } from './encoding';

/** Generate a room ID with at least 128 bits of randomness. */
export function generateRoomId(): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Generate a unique operation ID. */
export function generateOpId(): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Generate a random client ID for a WebSocket connection. */
export function generateClientId(): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Generate a 256-bit room secret.
 * Returns raw bytes (not base64url) because deriveRoomKeys() takes bytes directly.
 * The URL helper handles encoding for the fragment.
 */
export function generateRoomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Generate a 256-bit admin secret. Returns raw bytes. */
export function generateAdminSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Generate a random nonce for challenge-response. */
export function generateNonce(): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Generate a challenge ID with "ch_" prefix. */
export function generateChallengeId(): string {
  return 'ch_' + bytesToBase64url(crypto.getRandomValues(new Uint8Array(16)));
}
