import { describe, expect, test } from 'bun:test';
import { redactRoomSecrets } from './redact-url';

describe('redactRoomSecrets', () => {
  test('returns empty string for null / undefined / empty', () => {
    expect(redactRoomSecrets(null)).toBe('');
    expect(redactRoomSecrets(undefined)).toBe('');
    expect(redactRoomSecrets('')).toBe('');
  });

  test('leaves URLs without secrets untouched', () => {
    expect(redactRoomSecrets('https://example.com/path')).toBe('https://example.com/path');
    expect(redactRoomSecrets('https://example.com/?q=1')).toBe('https://example.com/?q=1');
    expect(redactRoomSecrets('/relative/path#section')).toBe('/relative/path#section');
  });

  test('strips key from fragment (leading position)', () => {
    const url = 'https://room.plannotator.ai/c/abc123#key=AAAABBBBCCCC';
    // Fragment becomes "key=" which is all-scrubbed, so the entire fragment
    // including the `#` is dropped.
    expect(redactRoomSecrets(url)).toBe('https://room.plannotator.ai/c/abc123');
  });

  test('strips admin from fragment (second position)', () => {
    const url = 'https://room.plannotator.ai/c/abc#key=AAA&admin=BBB';
    expect(redactRoomSecrets(url)).toBe('https://room.plannotator.ai/c/abc');
  });

  test('strips key/admin from querystring preserving other params', () => {
    const url = 'https://example.com/?foo=1&key=SECRET&bar=2&admin=SECRET';
    expect(redactRoomSecrets(url)).toBe('https://example.com/?foo=1&key=&bar=2&admin=');
  });

  test('preserves fragment content when only part is secret', () => {
    // Fragment contains `key=X` AND non-secret content — fragment must be kept.
    const url = 'https://example.com/page#section-2&key=SECRET';
    expect(redactRoomSecrets(url)).toBe('https://example.com/page#section-2&key=');
  });

  test('is case-insensitive on param name', () => {
    const url = 'https://example.com/#KEY=abc&Admin=def';
    expect(redactRoomSecrets(url)).toBe('https://example.com/');
  });

  test('is idempotent', () => {
    const url = 'https://room.plannotator.ai/c/abc#key=ZZZZ&admin=YYYY';
    const once = redactRoomSecrets(url);
    const twice = redactRoomSecrets(once);
    expect(twice).toBe(once);
  });

  test('does not falsely match keys that happen to contain "key" or "admin"', () => {
    const url = 'https://example.com/?apikey=abc&sadmin=def';
    // "apikey" and "sadmin" must NOT be scrubbed; only exact `key` / `admin`
    // match the boundary regex.
    expect(redactRoomSecrets(url)).toBe('https://example.com/?apikey=abc&sadmin=def');
  });

  test('handles URL where fragment has multiple scrubbed secrets plus a preserved non-secret param', () => {
    const url = 'https://example.com/#page=3&key=AA&admin=BB';
    expect(redactRoomSecrets(url)).toBe('https://example.com/#page=3&key=&admin=');
  });

  test('handles non-URL strings without throwing', () => {
    expect(redactRoomSecrets('just some text')).toBe('just some text');
    // Bare "key=..." at start-of-string is intentionally scrubbed — better to
    // over-redact if a caller hands us an unexpected value than to leak.
    expect(redactRoomSecrets('key=notaurl')).toBe('key=');
  });

  test('handles empty fragment and empty query gracefully', () => {
    expect(redactRoomSecrets('https://example.com/#')).toBe('https://example.com/');
    expect(redactRoomSecrets('https://example.com/?')).toBe('https://example.com/?');
  });

  test('non-string input (defensive) returns empty', () => {
    expect(redactRoomSecrets(42 as unknown as string)).toBe('');
    expect(redactRoomSecrets({} as unknown as string)).toBe('');
  });
});
