/**
 * Request body validation — pure functions, no Cloudflare APIs.
 * Fully testable with bun:test.
 */

import type { CreateRoomRequest, ServerEnvelope, AdminCommandEnvelope } from '@plannotator/shared/collab';

export interface ValidationError {
  error: string;
  status: number;
}

const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 30;
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_SNAPSHOT_CIPHERTEXT_LENGTH = 1_500_000; // ~1.5 MB
const MAX_EVENT_CIPHERTEXT_LENGTH = 512_000; // ~512 KB per event
const MAX_PRESENCE_CIPHERTEXT_LENGTH = 8_192; // ~8 KB per presence update

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

/** Type guard: is the result a ValidationError? Works with any validated union. */
export function isValidationError<T>(result: T | ValidationError): result is ValidationError {
  return typeof result === 'object' && result !== null && 'error' in result;
}

// ---------------------------------------------------------------------------
// Post-Auth Message Validation (Slice 3)
// ---------------------------------------------------------------------------

const VALID_CHANNELS = new Set(['event', 'presence']);
const VALID_ADMIN_COMMANDS = new Set(['room.lock', 'room.unlock', 'room.delete']);

/** Validate a ServerEnvelope from an authenticated WebSocket message. */
export function validateServerEnvelope(
  msg: Record<string, unknown>,
): ServerEnvelope | ValidationError {
  if (!isNonEmptyString(msg.clientId)) {
    return { error: 'Missing or empty "clientId"', status: 400 };
  }
  if (!isNonEmptyString(msg.opId)) {
    return { error: 'Missing or empty "opId"', status: 400 };
  }
  if (!isNonEmptyString(msg.channel) || !VALID_CHANNELS.has(msg.channel)) {
    return { error: '"channel" must be "event" or "presence"', status: 400 };
  }
  if (!isNonEmptyString(msg.ciphertext)) {
    return { error: 'Missing or empty "ciphertext"', status: 400 };
  }

  const maxSize = msg.channel === 'presence'
    ? MAX_PRESENCE_CIPHERTEXT_LENGTH
    : MAX_EVENT_CIPHERTEXT_LENGTH;
  if (msg.ciphertext.length > maxSize) {
    return { error: `Ciphertext exceeds max size for ${msg.channel} (${Math.round(maxSize / 1024)} KB)`, status: 413 };
  }

  return {
    clientId: msg.clientId,
    opId: msg.opId,
    channel: msg.channel as 'event' | 'presence',
    ciphertext: msg.ciphertext,
  };
}

/** Validate an AdminCommandEnvelope from an authenticated WebSocket message. */
export function validateAdminCommandEnvelope(
  msg: Record<string, unknown>,
): AdminCommandEnvelope | ValidationError {
  if (!isNonEmptyString(msg.challengeId)) {
    return { error: 'Missing or empty "challengeId"', status: 400 };
  }
  if (!isNonEmptyString(msg.clientId)) {
    return { error: 'Missing or empty "clientId"', status: 400 };
  }
  if (!isNonEmptyString(msg.adminProof)) {
    return { error: 'Missing or empty "adminProof"', status: 400 };
  }

  if (!msg.command || typeof msg.command !== 'object') {
    return { error: 'Missing or invalid "command"', status: 400 };
  }

  const cmd = msg.command as Record<string, unknown>;
  if (!isNonEmptyString(cmd.type) || !VALID_ADMIN_COMMANDS.has(cmd.type)) {
    return { error: `Unknown command type: ${String(cmd.type)}`, status: 400 };
  }

  // Validate room.lock snapshot pair — both present or both absent
  if (cmd.type === 'room.lock') {
    const hasCiphertext = isNonEmptyString(cmd.finalSnapshotCiphertext);
    const hasAtSeq = typeof cmd.finalSnapshotAtSeq === 'number';
    if (hasCiphertext !== hasAtSeq) {
      return { error: '"finalSnapshotCiphertext" and "finalSnapshotAtSeq" must be both present or both absent', status: 400 };
    }
    if (hasCiphertext && (cmd.finalSnapshotCiphertext as string).length > MAX_SNAPSHOT_CIPHERTEXT_LENGTH) {
      return { error: `"finalSnapshotCiphertext" exceeds max size (${Math.round(MAX_SNAPSHOT_CIPHERTEXT_LENGTH / 1024)} KB)`, status: 413 };
    }
    if (hasAtSeq && ((cmd.finalSnapshotAtSeq as number) < 0 || !Number.isInteger(cmd.finalSnapshotAtSeq))) {
      return { error: '"finalSnapshotAtSeq" must be a non-negative integer', status: 400 };
    }
  }

  return {
    type: 'admin.command',
    challengeId: msg.challengeId,
    clientId: msg.clientId,
    command: msg.command as AdminCommandEnvelope['command'],
    adminProof: msg.adminProof,
  };
}
