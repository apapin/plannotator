import { describe, expect, test } from 'bun:test';
import { bytesToBase64url, base64urlToBytes } from './encoding';

describe('bytesToBase64url', () => {
  test('encodes empty input', () => {
    expect(bytesToBase64url(new Uint8Array(0))).toBe('');
  });

  test('encodes single byte', () => {
    const result = bytesToBase64url(new Uint8Array([0xff]));
    expect(result).not.toContain('+');
    expect(result).not.toContain('/');
    expect(result).not.toContain('=');
  });

  test('encodes all 256 byte values', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const encoded = bytesToBase64url(bytes);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  test('handles large payloads (> 65K)', () => {
    const bytes = new Uint8Array(70_000);
    crypto.getRandomValues(bytes);
    const encoded = bytesToBase64url(bytes);
    expect(encoded.length).toBeGreaterThan(0);
    // Round-trip
    const decoded = base64urlToBytes(encoded);
    expect(decoded).toEqual(bytes);
  });
});

describe('base64urlToBytes', () => {
  test('decodes empty input', () => {
    expect(base64urlToBytes('')).toEqual(new Uint8Array(0));
  });

  test('round-trips through encode/decode', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encoded = bytesToBase64url(original);
    const decoded = base64urlToBytes(encoded);
    expect(decoded).toEqual(original);
  });

  test('decodes valid unpadded input (length 2 mod 4 = 1 source byte)', () => {
    // 1 byte -> 2 base64 chars (length % 4 === 2)
    const original = new Uint8Array([42]);
    const encoded = bytesToBase64url(original);
    expect(encoded.length % 4).toBe(2);
    expect(base64urlToBytes(encoded)).toEqual(original);
  });

  test('decodes valid unpadded input (length 3 mod 4 = 2 source bytes)', () => {
    // 2 bytes -> 3 base64 chars (length % 4 === 3)
    const original = new Uint8Array([42, 99]);
    const encoded = bytesToBase64url(original);
    expect(encoded.length % 4).toBe(3);
    expect(base64urlToBytes(encoded)).toEqual(original);
  });

  test('rejects length 1 mod 4 as malformed', () => {
    expect(() => base64urlToBytes('A')).toThrow('Invalid base64url');
    expect(() => base64urlToBytes('AAAAA')).toThrow('Invalid base64url');
  });

  test('handles URL-safe characters (- and _)', () => {
    // Encode bytes that produce + and / in standard base64
    const original = new Uint8Array([251, 255, 191]);
    const encoded = bytesToBase64url(original);
    expect(encoded).toContain('-');
    const decoded = base64urlToBytes(encoded);
    expect(decoded).toEqual(original);
  });
});
