/**
 * Slice 3 engine tests — validation, admin proofs, and lifecycle helpers.
 *
 * Tests act as external clients and import from @plannotator/shared/collab/client.
 */

import { describe, expect, test } from 'bun:test';
import {
  validateServerEnvelope,
  validateAdminCommandEnvelope,
  isValidationError,
} from './validation';
import type { ValidationError } from './validation';
import {
  deriveAdminKey,
  computeAdminVerifier,
  computeAdminProof,
  verifyAdminProof,
  generateChallengeId,
  generateNonce,
} from '@plannotator/shared/collab/client';
import type { AdminCommand } from '@plannotator/shared/collab';

// ---------------------------------------------------------------------------
// validateServerEnvelope
// ---------------------------------------------------------------------------

describe('validateServerEnvelope', () => {
  const validEvent = {
    clientId: 'client-1',
    opId: 'op-abc',
    channel: 'event',
    ciphertext: 'encrypted-data',
  };

  test('accepts valid event envelope', () => {
    const result = validateServerEnvelope(validEvent);
    expect(isValidationError(result)).toBe(false);
  });

  test('accepts valid presence envelope', () => {
    const result = validateServerEnvelope({ ...validEvent, channel: 'presence' });
    expect(isValidationError(result)).toBe(false);
  });

  test('rejects missing clientId', () => {
    const { clientId: _, ...rest } = validEvent;
    expect(isValidationError(validateServerEnvelope(rest))).toBe(true);
  });

  test('rejects missing opId', () => {
    const { opId: _, ...rest } = validEvent;
    expect(isValidationError(validateServerEnvelope(rest))).toBe(true);
  });

  test('rejects invalid channel', () => {
    expect(isValidationError(validateServerEnvelope({ ...validEvent, channel: 'invalid' }))).toBe(true);
  });

  test('rejects missing ciphertext', () => {
    const { ciphertext: _, ...rest } = validEvent;
    expect(isValidationError(validateServerEnvelope(rest))).toBe(true);
  });

  test('rejects oversized event ciphertext (> 512 KB)', () => {
    const result = validateServerEnvelope({ ...validEvent, ciphertext: 'x'.repeat(512_001) });
    expect(isValidationError(result)).toBe(true);
    expect((result as ValidationError).status).toBe(413);
  });

  test('rejects oversized presence ciphertext (> 8 KB)', () => {
    const result = validateServerEnvelope({ ...validEvent, channel: 'presence', ciphertext: 'x'.repeat(8_193) });
    expect(isValidationError(result)).toBe(true);
    expect((result as ValidationError).status).toBe(413);
  });
});

// ---------------------------------------------------------------------------
// validateAdminCommandEnvelope
// ---------------------------------------------------------------------------

describe('validateAdminCommandEnvelope', () => {
  const validLock = {
    type: 'admin.command',
    challengeId: 'ch_abc',
    clientId: 'client-1',
    command: { type: 'room.lock' },
    adminProof: 'proof-data',
  };

  test('accepts valid lock command', () => {
    const result = validateAdminCommandEnvelope(validLock);
    expect(isValidationError(result)).toBe(false);
  });

  test('accepts valid unlock command', () => {
    const result = validateAdminCommandEnvelope({ ...validLock, command: { type: 'room.unlock' } });
    expect(isValidationError(result)).toBe(false);
  });

  test('accepts valid delete command', () => {
    const result = validateAdminCommandEnvelope({ ...validLock, command: { type: 'room.delete' } });
    expect(isValidationError(result)).toBe(false);
  });

  test('accepts lock with snapshot pair', () => {
    const result = validateAdminCommandEnvelope({
      ...validLock,
      command: { type: 'room.lock', finalSnapshotCiphertext: 'encrypted', finalSnapshotAtSeq: 5 },
    });
    expect(isValidationError(result)).toBe(false);
  });

  test('rejects lock with ciphertext but no atSeq', () => {
    const result = validateAdminCommandEnvelope({
      ...validLock,
      command: { type: 'room.lock', finalSnapshotCiphertext: 'encrypted' },
    });
    expect(isValidationError(result)).toBe(true);
    expect((result as ValidationError).error).toContain('both present or both absent');
  });

  test('rejects lock with atSeq but no ciphertext', () => {
    const result = validateAdminCommandEnvelope({
      ...validLock,
      command: { type: 'room.lock', finalSnapshotAtSeq: 5 },
    });
    expect(isValidationError(result)).toBe(true);
  });

  test('rejects oversized snapshot in lock', () => {
    const result = validateAdminCommandEnvelope({
      ...validLock,
      command: { type: 'room.lock', finalSnapshotCiphertext: 'x'.repeat(1_500_001), finalSnapshotAtSeq: 5 },
    });
    expect(isValidationError(result)).toBe(true);
    expect((result as ValidationError).status).toBe(413);
  });

  test('rejects unknown command type', () => {
    expect(isValidationError(validateAdminCommandEnvelope({ ...validLock, command: { type: 'room.explode' } }))).toBe(true);
  });

  test('rejects missing challengeId', () => {
    const { challengeId: _, ...rest } = validLock;
    expect(isValidationError(validateAdminCommandEnvelope(rest))).toBe(true);
  });

  test('rejects missing adminProof', () => {
    const { adminProof: _, ...rest } = validLock;
    expect(isValidationError(validateAdminCommandEnvelope(rest))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin Proof Round-Trip
// ---------------------------------------------------------------------------

const ADMIN_SECRET = new Uint8Array(32);
ADMIN_SECRET.fill(0xcd);
const ROOM_ID = 'test-room-admin-proof';

describe('admin proof verification (end-to-end)', () => {
  test('valid admin proof is accepted', async () => {
    const adminKey = await deriveAdminKey(ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const command: AdminCommand = { type: 'room.lock' };

    const proof = await computeAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, command);
    const valid = await verifyAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, command, proof);
    expect(valid).toBe(true);
  });

  test('wrong proof is rejected', async () => {
    const adminKey = await deriveAdminKey(ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const command: AdminCommand = { type: 'room.lock' };

    const valid = await verifyAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, command, 'garbage-proof');
    expect(valid).toBe(false);
  });

  test('lock proof cannot verify as delete (command binding via canonicalJson)', async () => {
    const adminKey = await deriveAdminKey(ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    const lockCommand: AdminCommand = { type: 'room.lock' };
    const deleteCommand: AdminCommand = { type: 'room.delete' };

    const proof = await computeAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, lockCommand);
    const valid = await verifyAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, deleteCommand, proof);
    expect(valid).toBe(false);
  });

  test('lock proof with snapshot is bound to snapshot content', async () => {
    const adminKey = await deriveAdminKey(ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    const cmd1: AdminCommand = { type: 'room.lock', finalSnapshotCiphertext: 'aaa', finalSnapshotAtSeq: 5 };
    const cmd2: AdminCommand = { type: 'room.lock', finalSnapshotCiphertext: 'bbb', finalSnapshotAtSeq: 5 };

    const proof = await computeAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, cmd1);
    const valid = await verifyAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, cmd2, proof);
    expect(valid).toBe(false);
  });
});
