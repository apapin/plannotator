import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { storeAdminSecret, loadAdminSecret, clearAdminSecret } from './adminSecretStorage';

// 43-char base64url values for 32 random bytes — matches the on-wire admin
// secret shape validated by `isBase64Url32ByteString`.
const VALID_A = 'A'.repeat(43);
const VALID_B = 'B'.repeat(43);
const VALID_C = 'C'.repeat(43);

describe('adminSecretStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  test('store/load round-trip', () => {
    storeAdminSecret('room-a', VALID_A);
    expect(loadAdminSecret('room-a')).toBe(VALID_A);
  });

  test('load returns null for unknown roomId', () => {
    expect(loadAdminSecret('nonexistent')).toBeNull();
  });

  test('entries are scoped per roomId — storing one does not affect another', () => {
    storeAdminSecret('room-a', VALID_A);
    storeAdminSecret('room-b', VALID_B);
    expect(loadAdminSecret('room-a')).toBe(VALID_A);
    expect(loadAdminSecret('room-b')).toBe(VALID_B);
  });

  test('clear removes only the targeted room', () => {
    storeAdminSecret('room-a', VALID_A);
    storeAdminSecret('room-b', VALID_B);
    clearAdminSecret('room-a');
    expect(loadAdminSecret('room-a')).toBeNull();
    expect(loadAdminSecret('room-b')).toBe(VALID_B);
  });

  test('clear on unknown roomId is a no-op', () => {
    expect(() => clearAdminSecret('nonexistent')).not.toThrow();
  });

  test('overwriting an existing secret replaces the old value', () => {
    storeAdminSecret('room-a', VALID_A);
    storeAdminSecret('room-a', VALID_C);
    expect(loadAdminSecret('room-a')).toBe(VALID_C);
  });

  test('uses the documented key prefix so storage inspection is predictable', () => {
    storeAdminSecret('room-xyz', VALID_A);
    expect(sessionStorage.getItem('plannotator.room.admin.room-xyz')).toBe(VALID_A);
  });

  test('load rejects and evicts a malformed stored value', () => {
    // Simulate a corrupted sessionStorage entry — shape validation catches
    // pre-validation values from older builds or external tampering.
    sessionStorage.setItem('plannotator.room.admin.room-a', 'not-a-valid-secret');
    expect(loadAdminSecret('room-a')).toBeNull();
    // Evicted so subsequent reads don't keep rejecting the same garbage.
    expect(sessionStorage.getItem('plannotator.room.admin.room-a')).toBeNull();
  });

  test('load rejects a stored value of the wrong length even if base64url-safe', () => {
    // 42 chars — one short of a 32-byte base64url string.
    sessionStorage.setItem('plannotator.room.admin.room-a', 'A'.repeat(42));
    expect(loadAdminSecret('room-a')).toBeNull();
    expect(sessionStorage.getItem('plannotator.room.admin.room-a')).toBeNull();
  });
});
