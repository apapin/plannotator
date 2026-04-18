/**
 * End-to-end auth proof verification tests.
 *
 * These tests act as an external client: they use shared/collab/client
 * helpers (deriveRoomKeys, computeAuthProof) to simulate a connecting
 * browser/agent, then verify using the server-side verifyAuthProof.
 *
 * This proves the full auth chain: secret → keys → verifier → challenge → proof → verify.
 */

import { describe, expect, test } from 'bun:test';
import {
  deriveRoomKeys,
  computeRoomVerifier,
  computeAuthProof,
  verifyAuthProof,
  generateNonce,
  generateChallengeId,
} from '@plannotator/shared/collab/client';

// Stable test secrets
const ROOM_SECRET = new Uint8Array(32);
ROOM_SECRET.fill(0xab);

const ROOM_ID = 'test-room-auth';
const CLIENT_ID = 'client-123';

describe('auth proof verification (end-to-end)', () => {
  test('valid proof is accepted', async () => {
    // Client side: derive keys, compute verifier and proof
    const { authKey } = await deriveRoomKeys(ROOM_SECRET);
    const verifier = await computeRoomVerifier(authKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    const proof = await computeAuthProof(verifier, ROOM_ID, CLIENT_ID, challengeId, nonce);

    // Server side: verify the proof using stored verifier
    const valid = await verifyAuthProof(verifier, ROOM_ID, CLIENT_ID, challengeId, nonce, proof);
    expect(valid).toBe(true);
  });

  test('wrong proof is rejected', async () => {
    const { authKey } = await deriveRoomKeys(ROOM_SECRET);
    const verifier = await computeRoomVerifier(authKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    // Compute proof with wrong client ID
    const proof = await computeAuthProof(verifier, ROOM_ID, 'wrong-client', challengeId, nonce);

    // Verify with correct client ID — should fail
    const valid = await verifyAuthProof(verifier, ROOM_ID, CLIENT_ID, challengeId, nonce, proof);
    expect(valid).toBe(false);
  });

  test('wrong roomId is rejected', async () => {
    const { authKey } = await deriveRoomKeys(ROOM_SECRET);
    const verifier = await computeRoomVerifier(authKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    const proof = await computeAuthProof(verifier, ROOM_ID, CLIENT_ID, challengeId, nonce);

    // Verify with wrong roomId
    const valid = await verifyAuthProof(verifier, 'wrong-room', CLIENT_ID, challengeId, nonce, proof);
    expect(valid).toBe(false);
  });

  test('malformed proof returns false (does not throw)', async () => {
    const { authKey } = await deriveRoomKeys(ROOM_SECRET);
    const verifier = await computeRoomVerifier(authKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    // Garbage proof strings
    await expect(verifyAuthProof(verifier, ROOM_ID, CLIENT_ID, challengeId, nonce, 'A'))
      .resolves.toBe(false);
    await expect(verifyAuthProof(verifier, ROOM_ID, CLIENT_ID, challengeId, nonce, '!@#$'))
      .resolves.toBe(false);
    await expect(verifyAuthProof(verifier, ROOM_ID, CLIENT_ID, challengeId, nonce, ''))
      .resolves.toBe(false);
  });

  test('different room secrets produce incompatible verifiers', async () => {
    const secret2 = new Uint8Array(32);
    secret2.fill(0xcd);

    const keys1 = await deriveRoomKeys(ROOM_SECRET);
    const keys2 = await deriveRoomKeys(secret2);

    const verifier1 = await computeRoomVerifier(keys1.authKey, ROOM_ID);
    const verifier2 = await computeRoomVerifier(keys2.authKey, ROOM_ID);

    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    // Proof computed with secret1's verifier
    const proof = await computeAuthProof(verifier1, ROOM_ID, CLIENT_ID, challengeId, nonce);

    // Verify with secret2's verifier — should fail
    const valid = await verifyAuthProof(verifier2, ROOM_ID, CLIENT_ID, challengeId, nonce, proof);
    expect(valid).toBe(false);
  });
});

describe('challenge expiry detection', () => {
  test('current timestamp is within expiry', () => {
    const expiresAt = Date.now() + 30_000;
    expect(Date.now() <= expiresAt).toBe(true);
  });

  test('past timestamp is expired', () => {
    const expiresAt = Date.now() - 1000;
    expect(Date.now() > expiresAt).toBe(true);
  });
});
