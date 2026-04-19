/**
 * Shape validators shared between AppRoot (admin-secret fragments)
 * and the Bun / Pi servers (`/api/approve` permission-mode bodies).
 */

/**
 * 43-character base64url pattern for a 32-byte random value.
 *
 * Live Rooms uses this shape for admin secrets
 * (`ADMIN_SECRET_LENGTH_BYTES === 32`; see `./constants.ts`).
 */
export const BASE64URL_32_BYTE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isBase64Url32ByteString(value: unknown): value is string {
  return typeof value === 'string' && BASE64URL_32_BYTE_RE.test(value);
}

const VALID_PERMISSION_MODES = new Set(['bypassPermissions', 'acceptEdits', 'default']);

/**
 * Accepts the three Claude Code permission-mode tokens. Used by the
 * local `/api/approve` handlers in both servers to validate the
 * request body's `permissionMode` field before forwarding it into
 * the hook result.
 */
export function isValidPermissionMode(
  value: unknown,
): value is 'bypassPermissions' | 'acceptEdits' | 'default' {
  return typeof value === 'string' && VALID_PERMISSION_MODES.has(value);
}
