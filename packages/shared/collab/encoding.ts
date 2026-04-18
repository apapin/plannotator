/**
 * Base64url encode/decode helpers.
 *
 * Exported for use by collab crypto, IDs, and URL modules.
 * Uses only btoa/atob — portable across browsers, Bun, and Cloudflare Workers.
 */

/** Encode a Uint8Array to a URL-safe base64 string (no padding). */
export function bytesToBase64url(bytes: Uint8Array): string {
  // Loop to avoid RangeError on large payloads (>65K args to String.fromCharCode)
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Decode a URL-safe base64 string to a Uint8Array.
 *
 * Normalizes padding before atob for cross-runtime safety.
 * Rejects strings whose length is 1 mod 4 (no valid byte count produces that length).
 */
export function base64urlToBytes(b64: string): Uint8Array {
  if (b64.length % 4 === 1) {
    throw new Error('Invalid base64url: length mod 4 cannot be 1');
  }
  // Restore standard base64 characters
  const base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  // Normalize padding
  const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
