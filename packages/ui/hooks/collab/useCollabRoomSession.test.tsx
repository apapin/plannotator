import { describe, expect, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useCollabRoomSession } from './useCollabRoomSession';
import type { CollabRoomUser } from '@plannotator/shared/collab/client';

const USER: CollabRoomUser = { id: 'u1', name: 'alice', color: '#f00' };

/**
 * Join-only wrapper sanity. Full WebSocket lifecycle is covered by
 * packages/shared/collab/client-runtime tests; here we check URL
 * parsing and the share-link rebuild path.
 */
describe('useCollabRoomSession — join intent', () => {
  test('starts in "ready" phase immediately (no HTTP)', () => {
    // enabled:false to keep this shape-only — we're not exercising the
    // WebSocket lifecycle here, just the wrapper's return shape. Leaving
    // it enabled would open a real ws against localhost in the test env
    // and surface an unhandled ws error between tests.
    const { result } = renderHook(() =>
      useCollabRoomSession({
        intent: 'join',
        url: 'http://localhost/c/room123#key=' + 'A'.repeat(43),
        user: USER,
        enabled: false,
      }),
    );
    expect(result.current.phase).toBe('ready');
    // room is present (useCollabRoom-returned object) even if connection is disabled.
    expect(result.current.room).toBeDefined();
    expect(result.current.joinUrl).toContain('/c/room123');
  });

  test('does not connect when disabled=false', async () => {
    const { result } = renderHook(() =>
      useCollabRoomSession({
        intent: 'join',
        url: 'http://localhost/c/room123#key=' + 'A'.repeat(43),
        user: USER,
        enabled: false,
      }),
    );
    expect(result.current.phase).toBe('ready');
    // useCollabRoom returns DISCONNECTED_STATE under enabled=false.
    expect(result.current.room?.connectionStatus).toBe('disconnected');
  });

  test('surfaces "error" phase for an unparseable URL', () => {
    const { result } = renderHook(() =>
      useCollabRoomSession({
        intent: 'join',
        url: 'not-a-room-url',
        user: USER,
        enabled: false,
      }),
    );
    expect(result.current.phase).toBe('error');
    expect(result.current.error?.code).toBe('invalid_room_url');
  });
});
