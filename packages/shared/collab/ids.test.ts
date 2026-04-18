import { describe, expect, test } from 'bun:test';
import {
  generateRoomId,
  generateOpId,
  generateClientId,
  generateRoomSecret,
  generateAdminSecret,
  generateNonce,
  generateChallengeId,
} from './ids';
import { base64urlToBytes } from './encoding';

describe('generateRoomId', () => {
  test('produces at least 128 bits of entropy', () => {
    const id = generateRoomId();
    const bytes = base64urlToBytes(id);
    expect(bytes.length).toBeGreaterThanOrEqual(16);
  });

  test('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRoomId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateOpId', () => {
  test('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateOpId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateClientId', () => {
  test('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateClientId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateRoomSecret', () => {
  test('returns exactly 32 bytes', () => {
    expect(generateRoomSecret().length).toBe(32);
  });

  test('returns Uint8Array', () => {
    expect(generateRoomSecret()).toBeInstanceOf(Uint8Array);
  });
});

describe('generateAdminSecret', () => {
  test('returns exactly 32 bytes', () => {
    expect(generateAdminSecret().length).toBe(32);
  });
});

describe('generateNonce', () => {
  test('decodes to 32 bytes', () => {
    const nonce = generateNonce();
    const bytes = base64urlToBytes(nonce);
    expect(bytes.length).toBe(32);
  });
});

describe('generateChallengeId', () => {
  test('starts with ch_ prefix', () => {
    expect(generateChallengeId()).toMatch(/^ch_/);
  });

  test('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateChallengeId()));
    expect(ids.size).toBe(100);
  });
});
