import { describe, expect, test } from 'bun:test';
import {
  deriveRoomKeys,
  deriveAdminKey,
  computeRoomVerifier,
  computeAdminVerifier,
  computeAuthProof,
  verifyAuthProof,
  computeAdminProof,
  verifyAdminProof,
  encryptPayload,
  decryptPayload,
  encryptEventOp,
  decryptEventPayload,
  encryptPresence,
  decryptPresence,
  encryptSnapshot,
  decryptSnapshot,
} from './crypto';
import type { AdminCommand, PresenceState, RoomEventClientOp, RoomSnapshot } from './types';

// Stable test secret (32 bytes)
const TEST_SECRET = new Uint8Array(32);
TEST_SECRET.fill(0xab);

const TEST_ADMIN_SECRET = new Uint8Array(32);
TEST_ADMIN_SECRET.fill(0xcd);

const TEST_ROOM_ID = 'test-room-abc123';

// ---------------------------------------------------------------------------
// Key Derivation — tested via observable outputs
// ---------------------------------------------------------------------------

describe('deriveRoomKeys', () => {
  test('rejects non-256-bit room secrets', async () => {
    await expect(deriveRoomKeys(new Uint8Array(31))).rejects.toThrow('Invalid room secret');
    await expect(deriveRoomKeys(new Uint8Array(33))).rejects.toThrow('Invalid room secret');
  });

  test('same secret produces same verifier (deterministic)', async () => {
    const keys1 = await deriveRoomKeys(TEST_SECRET);
    const keys2 = await deriveRoomKeys(TEST_SECRET);

    const v1 = await computeRoomVerifier(keys1.authKey, TEST_ROOM_ID);
    const v2 = await computeRoomVerifier(keys2.authKey, TEST_ROOM_ID);
    expect(v1).toBe(v2);
  });

  test('derives from the Uint8Array view, not the entire backing buffer', async () => {
    const backing = new Uint8Array(96);
    backing.fill(0xee);
    backing.set(TEST_SECRET, 32);
    const secretView = backing.subarray(32, 64);

    const keys1 = await deriveRoomKeys(TEST_SECRET);
    const keys2 = await deriveRoomKeys(secretView);

    const v1 = await computeRoomVerifier(keys1.authKey, TEST_ROOM_ID);
    const v2 = await computeRoomVerifier(keys2.authKey, TEST_ROOM_ID);
    expect(v1).toBe(v2);
  });

  test('different secrets produce different verifiers', async () => {
    const secret2 = new Uint8Array(32);
    secret2.fill(0x99);

    const keys1 = await deriveRoomKeys(TEST_SECRET);
    const keys2 = await deriveRoomKeys(secret2);

    const v1 = await computeRoomVerifier(keys1.authKey, TEST_ROOM_ID);
    const v2 = await computeRoomVerifier(keys2.authKey, TEST_ROOM_ID);
    expect(v1).not.toBe(v2);
  });

  test('different labels produce different keys (cross-key isolation)', async () => {
    const { eventKey, presenceKey } = await deriveRoomKeys(TEST_SECRET);

    // Encrypt with event key, try to decrypt with presence key — should fail
    const ciphertext = await encryptPayload(eventKey, 'secret message');
    await expect(decryptPayload(presenceKey, ciphertext)).rejects.toThrow();
  });
});

describe('deriveAdminKey', () => {
  test('rejects non-256-bit admin secrets', async () => {
    await expect(deriveAdminKey(new Uint8Array(31))).rejects.toThrow('Invalid admin secret');
    await expect(deriveAdminKey(new Uint8Array(33))).rejects.toThrow('Invalid admin secret');
  });

  test('same secret produces same admin verifier', async () => {
    const key1 = await deriveAdminKey(TEST_ADMIN_SECRET);
    const key2 = await deriveAdminKey(TEST_ADMIN_SECRET);

    const v1 = await computeAdminVerifier(key1, TEST_ROOM_ID);
    const v2 = await computeAdminVerifier(key2, TEST_ROOM_ID);
    expect(v1).toBe(v2);
  });

  test('derives admin key from the Uint8Array view, not the entire backing buffer', async () => {
    const backing = new Uint8Array(96);
    backing.fill(0xee);
    backing.set(TEST_ADMIN_SECRET, 32);
    const secretView = backing.subarray(32, 64);

    const key1 = await deriveAdminKey(TEST_ADMIN_SECRET);
    const key2 = await deriveAdminKey(secretView);

    const v1 = await computeAdminVerifier(key1, TEST_ROOM_ID);
    const v2 = await computeAdminVerifier(key2, TEST_ROOM_ID);
    expect(v1).toBe(v2);
  });
});

// ---------------------------------------------------------------------------
// Verifiers
// ---------------------------------------------------------------------------

describe('computeRoomVerifier', () => {
  test('different roomIds produce different verifiers', async () => {
    const { authKey } = await deriveRoomKeys(TEST_SECRET);
    const v1 = await computeRoomVerifier(authKey, 'room-a');
    const v2 = await computeRoomVerifier(authKey, 'room-b');
    expect(v1).not.toBe(v2);
  });
});

// ---------------------------------------------------------------------------
// Auth Proofs
// ---------------------------------------------------------------------------

describe('auth proof', () => {
  test('compute and verify round-trip', async () => {
    const { authKey } = await deriveRoomKeys(TEST_SECRET);
    const verifier = await computeRoomVerifier(authKey, TEST_ROOM_ID);

    const proof = await computeAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123');
    const valid = await verifyAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123', proof);
    expect(valid).toBe(true);
  });

  test('wrong clientId rejects', async () => {
    const { authKey } = await deriveRoomKeys(TEST_SECRET);
    const verifier = await computeRoomVerifier(authKey, TEST_ROOM_ID);

    const proof = await computeAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123');
    const valid = await verifyAuthProof(verifier, TEST_ROOM_ID, 'client-2', 'ch_abc', 'nonce123', proof);
    expect(valid).toBe(false);
  });

  test('wrong nonce rejects', async () => {
    const { authKey } = await deriveRoomKeys(TEST_SECRET);
    const verifier = await computeRoomVerifier(authKey, TEST_ROOM_ID);

    const proof = await computeAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123');
    const valid = await verifyAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'wrong-nonce', proof);
    expect(valid).toBe(false);
  });

  test('wrong verifier rejects', async () => {
    const { authKey } = await deriveRoomKeys(TEST_SECRET);
    const verifier = await computeRoomVerifier(authKey, TEST_ROOM_ID);

    const secret2 = new Uint8Array(32);
    secret2.fill(0x11);
    const keys2 = await deriveRoomKeys(secret2);
    const wrongVerifier = await computeRoomVerifier(keys2.authKey, TEST_ROOM_ID);

    const proof = await computeAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123');
    const valid = await verifyAuthProof(wrongVerifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123', proof);
    expect(valid).toBe(false);
  });

  test('malformed proof rejects without throwing', async () => {
    const { authKey } = await deriveRoomKeys(TEST_SECRET);
    const verifier = await computeRoomVerifier(authKey, TEST_ROOM_ID);

    await expect(verifyAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123', 'A'))
      .resolves.toBe(false);
    await expect(verifyAuthProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_abc', 'nonce123', '!!!!'))
      .resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin Proofs
// ---------------------------------------------------------------------------

describe('admin proof', () => {
  test('compute and verify round-trip', async () => {
    const adminKey = await deriveAdminKey(TEST_ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, TEST_ROOM_ID);
    const command: AdminCommand = { type: 'room.lock' };

    const proof = await computeAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'nonce456', command);
    const valid = await verifyAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'nonce456', command, proof);
    expect(valid).toBe(true);
  });

  test('wrong command rejects (lock proof cannot be used as delete)', async () => {
    const adminKey = await deriveAdminKey(TEST_ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, TEST_ROOM_ID);
    const lockCommand: AdminCommand = { type: 'room.lock' };
    const deleteCommand: AdminCommand = { type: 'room.delete' };

    const proof = await computeAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'nonce456', lockCommand);
    const valid = await verifyAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'nonce456', deleteCommand, proof);
    expect(valid).toBe(false);
  });

  test('proof is bound to canonicalJson(command)', async () => {
    const adminKey = await deriveAdminKey(TEST_ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, TEST_ROOM_ID);

    // Same command with finalSnapshotCiphertext
    const cmd1: AdminCommand = { type: 'room.lock', finalSnapshotCiphertext: 'aaa' };
    const cmd2: AdminCommand = { type: 'room.lock', finalSnapshotCiphertext: 'bbb' };

    const proof = await computeAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'n', cmd1);
    const valid = await verifyAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'n', cmd2, proof);
    expect(valid).toBe(false);
  });

  test('malformed proof rejects without throwing', async () => {
    const adminKey = await deriveAdminKey(TEST_ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, TEST_ROOM_ID);
    const command: AdminCommand = { type: 'room.lock' };

    await expect(verifyAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'nonce456', command, 'A'))
      .resolves.toBe(false);
    await expect(verifyAdminProof(verifier, TEST_ROOM_ID, 'client-1', 'ch_xyz', 'nonce456', command, '!!!!'))
      .resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AES-256-GCM Encrypt / Decrypt
// ---------------------------------------------------------------------------

describe('encryptPayload / decryptPayload', () => {
  test('round-trip', async () => {
    const { eventKey } = await deriveRoomKeys(TEST_SECRET);
    const plaintext = 'hello, encrypted world!';
    const ciphertext = await encryptPayload(eventKey, plaintext);
    const decrypted = await decryptPayload(eventKey, ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  test('unique ciphertext per call (fresh IV)', async () => {
    const { eventKey } = await deriveRoomKeys(TEST_SECRET);
    const plaintext = 'same input';
    const ct1 = await encryptPayload(eventKey, plaintext);
    const ct2 = await encryptPayload(eventKey, plaintext);
    expect(ct1).not.toBe(ct2);
  });

  test('wrong key fails', async () => {
    const keys1 = await deriveRoomKeys(TEST_SECRET);
    const secret2 = new Uint8Array(32);
    secret2.fill(0x77);
    const keys2 = await deriveRoomKeys(secret2);

    const ciphertext = await encryptPayload(keys1.eventKey, 'secret');
    await expect(decryptPayload(keys2.eventKey, ciphertext)).rejects.toThrow();
  });

  test('tampered ciphertext fails', async () => {
    const { eventKey } = await deriveRoomKeys(TEST_SECRET);
    const ciphertext = await encryptPayload(eventKey, 'secret');

    // Flip a character in the middle
    const tampered = ciphertext.slice(0, 20) + 'X' + ciphertext.slice(21);
    await expect(decryptPayload(eventKey, tampered)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Channel Wrappers
// ---------------------------------------------------------------------------

describe('encryptEventOp / decryptEventPayload', () => {
  test('round-trip with annotation.add', async () => {
    const { eventKey } = await deriveRoomKeys(TEST_SECRET);
    const op: RoomEventClientOp = {
      type: 'annotation.add',
      annotations: [{
        id: 'ann-1',
        blockId: 'b1',
        startOffset: 0,
        endOffset: 10,
        type: 'COMMENT',
        originalText: 'hello',
        createdA: Date.now(),
        text: 'my comment',
      }],
    };

    const ciphertext = await encryptEventOp(eventKey, op);
    const decrypted = await decryptEventPayload(eventKey, ciphertext);
    expect(decrypted).toEqual(op);
  });
});

describe('encryptPresence / decryptPresence', () => {
  test('round-trip', async () => {
    const { presenceKey } = await deriveRoomKeys(TEST_SECRET);
    const presence: PresenceState = {
      user: { id: 'user-1', name: 'swift-falcon-tater', color: '#ff0000' },
      cursor: { blockId: 'block-3', x: 100, y: 200, coordinateSpace: 'block' },
      activeAnnotationId: 'ann-5',
      idle: false,
    };

    const ciphertext = await encryptPresence(presenceKey, presence);
    const decrypted = await decryptPresence(presenceKey, ciphertext);
    expect(decrypted).toEqual(presence);
  });
});

describe('encryptSnapshot / decryptSnapshot', () => {
  test('round-trip with real RoomSnapshot', async () => {
    const { eventKey } = await deriveRoomKeys(TEST_SECRET);
    const snapshot: RoomSnapshot = {
      versionId: 'v1',
      planMarkdown: '# My Plan\n\nStep 1: do the thing\nStep 2: profit',
      annotations: [
        {
          id: 'ann-1',
          blockId: 'b1',
          startOffset: 0,
          endOffset: 5,
          type: 'COMMENT',
          text: 'nice plan',
          originalText: 'My Plan',
          createdA: 1234567890,
          author: 'alice',
        },
        {
          id: 'ann-2',
          blockId: 'b2',
          startOffset: 0,
          endOffset: 13,
          type: 'DELETION',
          originalText: 'do the thing',
          createdA: 1234567891,
        },
      ],
    };

    const ciphertext = await encryptSnapshot(eventKey, snapshot);
    const decrypted = await decryptSnapshot(eventKey, ciphertext);
    expect(decrypted).toEqual(snapshot);
    expect(decrypted.versionId).toBe('v1');
    expect(decrypted.annotations.length).toBe(2);
  });
});
