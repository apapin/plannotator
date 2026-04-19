import { describe, expect, test } from 'bun:test';
import { parseRoomUrl, buildRoomJoinUrl, buildAdminRoomUrl } from './url';
import { generateRoomSecret, generateAdminSecret, generateRoomId } from './ids';

describe('parseRoomUrl', () => {
  test('parses valid room URL', () => {
    const secret = generateRoomSecret();
    const roomId = 'test-room-123';
    const url = buildRoomJoinUrl(roomId, secret);

    const parsed = parseRoomUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.roomId).toBe(roomId);
    expect(parsed!.roomSecret).toEqual(secret);
  });

  test('returns null for missing fragment', () => {
    expect(parseRoomUrl('https://room.plannotator.ai/c/abc123')).toBeNull();
  });

  test('returns null for missing key parameter', () => {
    expect(parseRoomUrl('https://room.plannotator.ai/c/abc123#other=value')).toBeNull();
  });

  test('returns null for wrong path', () => {
    expect(parseRoomUrl('https://room.plannotator.ai/p/abc123#key=AAAA')).toBeNull();
  });

  test('returns null for missing roomId', () => {
    expect(parseRoomUrl('https://room.plannotator.ai/c/#key=AAAA')).toBeNull();
  });

  test('returns null for empty key value', () => {
    expect(parseRoomUrl('https://room.plannotator.ai/c/abc123#key=')).toBeNull();
  });

  test('returns null for non-256-bit room secrets', () => {
    expect(parseRoomUrl('https://room.plannotator.ai/c/abc123#key=AQ')).toBeNull();
    expect(parseRoomUrl('https://room.plannotator.ai/c/abc123#key=AAAA')).toBeNull();
  });

  test('returns null for completely invalid URL', () => {
    expect(parseRoomUrl('not a url')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseRoomUrl('')).toBeNull();
  });
});

describe('buildRoomJoinUrl', () => {
  test('constructs URL with default base', () => {
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl('my-room', secret);
    expect(url).toMatch(/^https:\/\/room\.plannotator\.ai\/c\/my-room#key=/);
  });

  test('constructs URL with custom base', () => {
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl('my-room', secret, 'http://localhost:8787');
    expect(url).toMatch(/^http:\/\/localhost:8787\/c\/my-room#key=/);
  });

  test('rejects non-256-bit room secrets', () => {
    expect(() => buildRoomJoinUrl('my-room', new Uint8Array(31))).toThrow('Invalid room secret');
    expect(() => buildRoomJoinUrl('my-room', new Uint8Array(33))).toThrow('Invalid room secret');
  });
});

describe('round-trip', () => {
  test('parse(build(id, secret)) recovers same values', () => {
    const roomId = generateRoomId();
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl(roomId, secret);
    const parsed = parseRoomUrl(url);

    expect(parsed).not.toBeNull();
    expect(parsed!.roomId).toBe(roomId);
    expect(parsed!.roomSecret).toEqual(secret);
  });

  test('round-trip with custom base URL', () => {
    const roomId = 'custom-room';
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl(roomId, secret, 'https://custom.example.com');
    const parsed = parseRoomUrl(url);

    expect(parsed).not.toBeNull();
    expect(parsed!.roomId).toBe(roomId);
    expect(parsed!.roomSecret).toEqual(secret);
  });
});

describe('buildAdminRoomUrl', () => {
  test('constructs URL with both key and admin', () => {
    const secret = generateRoomSecret();
    const adminSecret = generateAdminSecret();
    const url = buildAdminRoomUrl('my-room', secret, adminSecret);
    expect(url).toContain('/c/my-room#key=');
    expect(url).toContain('&admin=');
  });

  test('rejects non-32-byte admin secret', () => {
    expect(() => buildAdminRoomUrl('room', generateRoomSecret(), new Uint8Array(31)))
      .toThrow('Invalid admin secret');
  });

  test('rejects non-32-byte room secret', () => {
    expect(() => buildAdminRoomUrl('room', new Uint8Array(31), generateAdminSecret()))
      .toThrow('Invalid room secret');
  });

  test('round-trip: parseRoomUrl recovers admin secret', () => {
    const roomId = generateRoomId();
    const secret = generateRoomSecret();
    const adminSecret = generateAdminSecret();
    const url = buildAdminRoomUrl(roomId, secret, adminSecret);
    const parsed = parseRoomUrl(url);

    expect(parsed).not.toBeNull();
    expect(parsed!.roomId).toBe(roomId);
    expect(parsed!.roomSecret).toEqual(secret);
    expect(parsed!.adminSecret).toEqual(adminSecret);
  });

  test('parseRoomUrl without admin leaves adminSecret undefined', () => {
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl('room-abc', secret);
    const parsed = parseRoomUrl(url);
    expect(parsed!.adminSecret).toBeUndefined();
  });

  test('parseRoomUrl rejects malformed admin (wrong length)', () => {
    // Manually construct URL with 1-byte admin
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl('room', secret) + '&admin=AQ';
    expect(parseRoomUrl(url)).toBeNull();
  });
});

describe('URL building — trailing slash hygiene (P3)', () => {
  test('buildRoomJoinUrl strips trailing slash from baseUrl', () => {
    const roomSecret = generateRoomSecret();
    const withSlash = buildRoomJoinUrl('room-42', roomSecret, 'https://example.com/');
    const withoutSlash = buildRoomJoinUrl('room-42', roomSecret, 'https://example.com');
    expect(withSlash).toBe(withoutSlash);
    expect(withSlash).not.toContain('com//c/');
  });

  test('buildAdminRoomUrl strips trailing slash from baseUrl', () => {
    const roomSecret = generateRoomSecret();
    const adminSecret = generateAdminSecret();
    const withSlash = buildAdminRoomUrl('r', roomSecret, adminSecret, 'https://example.com/');
    const withoutSlash = buildAdminRoomUrl('r', roomSecret, adminSecret, 'https://example.com');
    expect(withSlash).toBe(withoutSlash);
  });

  test('round-trips the constructed URL through parseRoomUrl regardless of trailing slash', () => {
    const roomSecret = generateRoomSecret();
    const roomId = generateRoomId();
    const url = buildRoomJoinUrl(roomId, roomSecret, 'https://example.com/');
    const parsed = parseRoomUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.roomId).toBe(roomId);
    expect(parsed!.roomSecret).toEqual(roomSecret);
  });
});
