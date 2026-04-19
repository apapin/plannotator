import { describe, expect, test } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { useCollabRoom } from './useCollabRoom';
import type { CollabRoomUser } from '@plannotator/shared/collab/client';

const USER: CollabRoomUser = { id: 'u1', name: 'alice', color: '#f00' };

/**
 * `lastErrorId` contract check for the join-phase error path.
 *
 * The shared client owns `lastErrorId` for client-internal errors, but join
 * failures happen before the client is wired up — the hook surfaces them via
 * its own branch. Without a hook-owned counter, that branch would spread
 * DISCONNECTED_STATE (`lastErrorId: 0`) and callers dedupe-ing on id would
 * silently ignore join errors.
 */
describe('useCollabRoom — join error id', () => {
  test('first join failure surfaces a positive lastErrorId', async () => {
    // Malformed URL triggers InvalidRoomUrlError in joinRoom() before any
    // network contact — deterministic failure, no timing.
    const { result } = renderHook(() =>
      useCollabRoom({
        url: 'not-a-room-url',
        user: USER,
      }),
    );

    await waitFor(() => {
      expect(result.current.lastError).not.toBeNull();
    });
    expect(result.current.lastError?.scope).toBe('join');
    expect(result.current.lastErrorId).toBeGreaterThan(0);
  });

  test('a second join failure bumps lastErrorId', async () => {
    let url = 'not-a-room-url';
    const { result, rerender } = renderHook(
      () => useCollabRoom({ url, user: USER }),
    );

    await waitFor(() => {
      expect(result.current.lastErrorId).toBeGreaterThan(0);
    });
    const firstId = result.current.lastErrorId;

    // Change the url so the effect tears down and re-runs with a fresh
    // failing URL; the hook should issue a new error id.
    url = 'also-not-a-room-url';
    rerender();

    await waitFor(() => {
      expect(result.current.lastError).not.toBeNull();
      expect(result.current.lastErrorId).toBeGreaterThan(firstId);
    });
  });
});
