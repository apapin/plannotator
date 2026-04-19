/**
 * Unit tests for createRoom() — focuses on the timeout + AbortSignal behavior.
 * Happy-path round-trips are covered by integration.test.ts against wrangler dev.
 */

import { describe, expect, test } from 'bun:test';
import { createRoom, CreateRoomError } from './create-room';
import type { CollabRoomUser } from './types';
import type { RoomSnapshot } from '../types';

const USER: CollabRoomUser = { id: 'u1', name: 'alice', color: '#f00' };
const SNAPSHOT: RoomSnapshot = { versionId: 'v1', planMarkdown: '# Plan', annotations: [] };

// A fetch impl that never resolves until its signal aborts. Mirrors the real
// AbortSignal wiring: when aborted, reject with an AbortError-like error.
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;  // without a signal, hang forever (caller bug)
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(signal.reason ?? new Error('aborted'));
      }, { once: true });
    });
  }) as typeof fetch;
}

describe('createRoom() — timeout and AbortSignal', () => {
  test('rejects with CreateRoomError when the server does not respond within timeoutMs', async () => {
    const start = Date.now();
    const promise = createRoom({
      baseUrl: 'http://localhost:9',
      initialSnapshot: SNAPSHOT,
      user: USER,
      fetchImpl: hangingFetch(),
      timeoutMs: 100,
    });

    // Timeout must fire — no stuck promise. Error message mentions 'timed out'
    // so callers can distinguish it from a transport failure.
    await expect(promise).rejects.toBeInstanceOf(CreateRoomError);
    await expect(promise).rejects.toMatchObject({ message: expect.stringContaining('timed out') });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);    // near timeoutMs
    expect(elapsed).toBeLessThan(1000);            // definitely not hanging
  });

  test('rejects immediately when the external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();  // pre-aborted

    const start = Date.now();
    const promise = createRoom({
      baseUrl: 'http://localhost:9',
      initialSnapshot: SNAPSHOT,
      user: USER,
      fetchImpl: hangingFetch(),
      signal: controller.signal,
      timeoutMs: 60_000,  // high — signal must short-circuit well before this
    });

    await expect(promise).rejects.toBeInstanceOf(CreateRoomError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);  // synchronous early rejection
  });

  test('rejects when the external signal aborts mid-fetch', async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = createRoom({
      baseUrl: 'http://localhost:9',
      initialSnapshot: SNAPSHOT,
      user: USER,
      fetchImpl: hangingFetch(),
      signal: controller.signal,
      timeoutMs: 60_000,
    });

    // Abort after a short delay — must interrupt the hanging fetch.
    setTimeout(() => controller.abort(new Error('user cancelled')), 50);

    await expect(promise).rejects.toBeInstanceOf(CreateRoomError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(1000);
  });
});
