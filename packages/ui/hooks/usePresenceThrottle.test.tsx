import { describe, expect, test, mock } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { usePresenceThrottle } from './usePresenceThrottle';

const TICK = 60;  // buffer above the 50ms throttle window for test timing

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

describe('usePresenceThrottle', () => {
  test('sends the first non-null state (after trailing delay)', async () => {
    const send = mock((_v: string) => {});
    const { rerender } = renderHook(
      ({ state }: { state: string | null }) => usePresenceThrottle(state, send, 50),
      { initialProps: { state: 'a' as string | null } },
    );
    await sleep(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('a');
    rerender({ state: 'a' });
  });

  test('collapses a rapid burst to a single trailing send carrying the latest value', async () => {
    const send = mock((_v: number) => {});
    const { rerender } = renderHook(
      ({ state }: { state: number | null }) => usePresenceThrottle(state, send, 50),
      { initialProps: { state: 1 as number | null } },
    );

    // Immediately bump the state several times within the throttle window.
    rerender({ state: 2 });
    rerender({ state: 3 });
    rerender({ state: 4 });

    await sleep(TICK);
    // Single send with the last value in the burst.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(4);
  });

  test('allows a second send after the throttle window elapses', async () => {
    const send = mock((_v: string) => {});
    const { rerender } = renderHook(
      ({ state }: { state: string | null }) => usePresenceThrottle(state, send, 50),
      { initialProps: { state: 'a' as string | null } },
    );
    await sleep(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    rerender({ state: 'b' });
    await sleep(TICK);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBe('b');
  });

  test('null cancels any pending send', async () => {
    const send = mock((_v: string) => {});
    const { rerender } = renderHook(
      ({ state }: { state: string | null }) => usePresenceThrottle(state, send, 50),
      { initialProps: { state: 'a' as string | null } },
    );
    // Before the trailing timer fires, transition to null.
    rerender({ state: null });
    await sleep(TICK);
    expect(send).not.toHaveBeenCalled();
  });

  test('no-op when send is undefined', async () => {
    let sendCalls = 0;
    const _fn = () => { sendCalls++; };
    const { rerender } = renderHook(
      ({ state, send }: { state: string | null; send: ((v: string) => void) | undefined }) =>
        usePresenceThrottle(state, send, 50),
      { initialProps: { state: 'a' as string | null, send: undefined as ((v: string) => void) | undefined } },
    );
    await sleep(TICK);
    expect(sendCalls).toBe(0);

    // Attach send later; next state change should send.
    rerender({ state: 'b', send: _fn });
    await sleep(TICK);
    expect(sendCalls).toBe(1);
  });

  test('cancels pending timer on unmount', async () => {
    const send = mock((_v: string) => {});
    const { rerender, unmount } = renderHook(
      ({ state }: { state: string | null }) => usePresenceThrottle(state, send, 50),
      { initialProps: { state: 'a' as string | null } },
    );
    rerender({ state: 'b' });  // schedule a send
    unmount();
    await sleep(TICK);
    expect(send).not.toHaveBeenCalled();
  });

  test('swallows throwing send so the throttle does not wedge', async () => {
    let callCount = 0;
    const send = (_: string) => {
      callCount++;
      if (callCount === 1) throw new Error('boom');
    };
    const { rerender } = renderHook(
      ({ state }: { state: string | null }) => usePresenceThrottle(state, send, 50),
      { initialProps: { state: 'a' as string | null } },
    );
    await sleep(TICK);
    expect(callCount).toBe(1);

    rerender({ state: 'b' });
    await sleep(TICK);
    expect(callCount).toBe(2);
  });
});
