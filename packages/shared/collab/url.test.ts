import { describe, expect, test } from 'bun:test';
import { parseRoomUrl, buildRoomJoinUrl } from './url';
import { generateRoomSecret, generateRoomId } from './ids';

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
