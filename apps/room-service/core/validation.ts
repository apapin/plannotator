/**
 * Request body validation — pure functions, no Cloudflare APIs.
 * Fully testable with bun:test.
 */

import type { CreateRoomRequest } from '@plannotator/shared/collab';

export interface ValidationError {
  error: string;
  status: number;
}

const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 30;
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_SNAPSHOT_CIPHERTEXT_LENGTH = 1_500_000; // ~1.5 MB

/** Clamp expiry days to [1, 30], default 30. */
export function clampExpiryDays(days: number | undefined): number {
  if (days === undefined || days === null) return DEFAULT_EXPIRY_DAYS;
  return Math.max(MIN_EXPIRY_DAYS, Math.min(MAX_EXPIRY_DAYS, Math.floor(days)));
}

/** True when a room is beyond its fixed retention deadline. */
export function hasRoomExpired(expiresAt: number, now: number = Date.now()): boolean {
  return now > expiresAt;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Room IDs are generated from 16 random bytes and base64url-encoded without padding.
 * That yields 22 URL-safe characters and 128 bits of entropy.
 */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * HMAC-SHA-256 output is 32 bytes, which base64url-encodes to 43 chars without padding.
 * Verifiers must match this exact shape.
 */
const VERIFIER_RE = /^[A-Za-z0-9_-]{43}$/;

/** Validate a POST /api/rooms request body. */
export function validateCreateRoomRequest(
  body: unknown,
): CreateRoomRequest | ValidationError {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object', status: 400 };
  }

  const obj = body as Record<string, unknown>;

  if (!isNonEmptyString(obj.roomId)) {
    return { error: 'Missing or empty "roomId"', status: 400 };
  }

  if (!ROOM_ID_RE.test(obj.roomId)) {
    return { error: '"roomId" must be exactly 22 base64url characters', status: 400 };
  }

  if (!isNonEmptyString(obj.roomVerifier) || !VERIFIER_RE.test(obj.roomVerifier)) {
    return { error: '"roomVerifier" must be a 43-char base64url HMAC-SHA-256 verifier', status: 400 };
  }

  if (!isNonEmptyString(obj.adminVerifier) || !VERIFIER_RE.test(obj.adminVerifier)) {
    return { error: '"adminVerifier" must be a 43-char base64url HMAC-SHA-256 verifier', status: 400 };
  }

  if (!isNonEmptyString(obj.initialSnapshotCiphertext)) {
    return { error: 'Missing or empty "initialSnapshotCiphertext"', status: 400 };
  }

  if (obj.initialSnapshotCiphertext.length > MAX_SNAPSHOT_CIPHERTEXT_LENGTH) {
    return { error: `"initialSnapshotCiphertext" exceeds max size (${Math.round(MAX_SNAPSHOT_CIPHERTEXT_LENGTH / 1024)} KB)`, status: 413 };
  }

  return {
    roomId: obj.roomId,
    roomVerifier: obj.roomVerifier,
    adminVerifier: obj.adminVerifier,
    initialSnapshotCiphertext: obj.initialSnapshotCiphertext,
    expiresInDays: typeof obj.expiresInDays === 'number' ? obj.expiresInDays : undefined,
  };
}

/** Type guard: is this a ValidationError (not a valid request)? */
export function isValidationError(result: CreateRoomRequest | ValidationError): result is ValidationError {
  return 'error' in result;
}
