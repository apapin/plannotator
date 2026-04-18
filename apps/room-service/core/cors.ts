/**
 * CORS handling for room.plannotator.ai.
 *
 * Localhost origins are allowed only when ALLOW_LOCALHOST_ORIGINS is explicitly
 * set to "true". This is intentional product behavior: Plannotator runs locally
 * on unpredictable ports and needs to call room.plannotator.ai/api/rooms when
 * the creator starts a live room. The room service still stores only ciphertext
 * and verifiers — room content access depends on the URL fragment secret.
 */

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** Matches localhost, 127.0.0.1, and [::1] with optional port. */
const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function getAllowedOrigins(envValue?: string): string[] {
  if (envValue) {
    return envValue.split(',').map((o) => o.trim());
  }
  return ['https://room.plannotator.ai'];
}

export function isLocalhostOrigin(origin: string): boolean {
  return LOOPBACK_RE.test(origin);
}

export function corsHeaders(
  requestOrigin: string,
  allowedOrigins: string[],
  allowLocalhostOrigins: boolean = false,
): Record<string, string> {
  const allowed =
    allowedOrigins.includes(requestOrigin) ||
    allowedOrigins.includes('*') ||
    (allowLocalhostOrigins && isLocalhostOrigin(requestOrigin));

  if (allowed) {
    return {
      ...BASE_CORS_HEADERS,
      'Access-Control-Allow-Origin': requestOrigin,
      'Vary': 'Origin',
    };
  }
  return {};
}
