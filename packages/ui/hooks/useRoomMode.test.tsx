import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useRoomMode } from './useRoomMode';
import { generateRoomSecret, generateAdminSecret } from '@plannotator/shared/collab';
import { buildRoomJoinUrl, buildAdminRoomUrl } from '@plannotator/shared/collab/client';

// happy-dom exposes the History API via window.location.href assignment and
// history.replaceState. We use the latter so the roomId in the path is valid
// without forcing a full navigation.
function setLocation(url: string) {
  window.history.replaceState(null, '', url);
}

// Note: parseRoomUrl accepts any non-empty pathname segment as a room ID.
// The server's stricter 22-char base64url check (isRoomId in validation.ts)
// runs at WebSocket upgrade time; the client parser is intentionally lenient
// so parse failures surface as 'invalid-room' (missing key/fragment) rather
// than roomId-shape errors.
const ROOM_ID = 'ROOM123';

describe('useRoomMode', () => {
  const originalHref = 'http://localhost/';

  beforeEach(() => {
    setLocation(originalHref);
  });

  afterEach(() => {
    setLocation(originalHref);
  });

  test('returns local mode on plain "/" with no fragment', () => {
    setLocation('http://localhost/');
    const { result } = renderHook(() => useRoomMode());
    expect(result.current).toEqual({ mode: 'local' });
  });

  test('returns room mode for a well-formed /c/:roomId#key= URL', () => {
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl(ROOM_ID, secret, 'http://localhost');
    setLocation(url);

    const { result } = renderHook(() => useRoomMode());
    expect(result.current.mode).toBe('room');
    if (result.current.mode === 'room') {
      expect(result.current.roomId).toBe(ROOM_ID);
      expect(result.current.url).toBe(url);
    }
  });

  test('returns room mode for a URL with both key and admin', () => {
    const secret = generateRoomSecret();
    const admin = generateAdminSecret();
    const url = buildAdminRoomUrl(ROOM_ID, secret, admin, 'http://localhost');
    setLocation(url);

    const { result } = renderHook(() => useRoomMode());
    expect(result.current.mode).toBe('room');
    if (result.current.mode === 'room') {
      expect(result.current.roomId).toBe(ROOM_ID);
    }
  });

  test('returns invalid-room on /c/:roomId with no fragment (not local)', () => {
    setLocation('http://localhost/c/ROOM123');
    const { result } = renderHook(() => useRoomMode());
    expect(result.current.mode).toBe('invalid-room');
  });

  test('returns invalid-room on /c/:roomId with malformed key (too short)', () => {
    setLocation('http://localhost/c/ROOM123#key=AAAA');
    const { result } = renderHook(() => useRoomMode());
    expect(result.current.mode).toBe('invalid-room');
  });

  test('returns invalid-room when key is not valid base64url', () => {
    setLocation('http://localhost/c/ROOM123#key=!!!invalid!!!');
    const { result } = renderHook(() => useRoomMode());
    expect(result.current.mode).toBe('invalid-room');
  });

  test('returns invalid-room when admin param is malformed', () => {
    const secret = generateRoomSecret();
    const keyParam = buildRoomJoinUrl(ROOM_ID, secret, 'http://localhost').split('#key=')[1];
    setLocation(`http://localhost/c/${ROOM_ID}#key=${keyParam}&admin=short`);
    const { result } = renderHook(() => useRoomMode());
    expect(result.current.mode).toBe('invalid-room');
  });

  test('returns local mode for non-/c/ paths with a key fragment', () => {
    const secret = generateRoomSecret();
    const keyParam = buildRoomJoinUrl(ROOM_ID, secret, 'http://localhost').split('#key=')[1];
    setLocation(`http://localhost/other/path#key=${keyParam}`);
    const { result } = renderHook(() => useRoomMode());
    expect(result.current).toEqual({ mode: 'local' });
  });

  test('ignores hashchange after initial mount (value is cached)', () => {
    const secret = generateRoomSecret();
    const url = buildRoomJoinUrl(ROOM_ID, secret, 'http://localhost');
    setLocation(url);
    const { result, rerender } = renderHook(() => useRoomMode());
    expect(result.current.mode).toBe('room');

    // Navigate away AFTER mount — the hook holds its initial read and does
    // not re-subscribe. Slice 5 contract: mode changes require a full reload.
    setLocation('http://localhost/');
    rerender();
    expect(result.current.mode).toBe('room');
  });
});
