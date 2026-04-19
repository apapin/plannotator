import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { captureCreatorIdentityFromFragment } from './roomIdentityHandoff';
import { getIdentity, getPresenceColor } from '@plannotator/ui/utils/identity';
import { isRoomIdentityConfirmed } from '@plannotator/ui/utils/roomIdentityConfirmed';

/**
 * Unit coverage for the cross-origin creator identity handoff.
 *
 * The function owns a narrow contract: given a URL fragment with
 * `&name=&color=`, it writes validated values into ConfigStore, marks
 * the room "confirmed" when BOTH landed, and strips both params from
 * the visible URL. It's path-gated to `/c/:roomId` so non-room shells
 * that happen to mount AppRoot can't have their static-share
 * fragments rewritten.
 */

function setLocation(pathname: string, hash: string): void {
  // happy-dom allows overriding href; pathname/hash are derived. Go
  // through history.replaceState to set state without triggering
  // navigation (same API the function under test uses to strip).
  window.history.replaceState(null, '', `${pathname}${hash ? `#${hash}` : ''}`);
}

beforeEach(() => {
  // Fresh slate per test: sessionStorage is shared across the file in
  // happy-dom, so we clear the flag keys the function writes to.
  sessionStorage.clear();
});

afterEach(() => {
  // Reset URL so a stripped-params test doesn't leak state into the next.
  setLocation('/', '');
});

describe('captureCreatorIdentityFromFragment — happy path', () => {
  test('both name and color present: writes ConfigStore, marks confirmed, strips params', () => {
    setLocation('/c/abc123', 'key=k&admin=a&name=Alice&color=%23f97316');
    captureCreatorIdentityFromFragment();

    expect(getIdentity()).toBe('Alice');
    expect(getPresenceColor()).toBe('#f97316');
    expect(isRoomIdentityConfirmed('abc123')).toBe(true);

    // `name` and `color` stripped; other fragment params preserved.
    expect(window.location.hash).not.toContain('name=');
    expect(window.location.hash).not.toContain('color=');
    expect(window.location.hash).toContain('key=k');
    expect(window.location.hash).toContain('admin=a');
  });
});

describe('captureCreatorIdentityFromFragment — partial / invalid', () => {
  test('only color landed: writes color, does NOT mark confirmed, still strips', () => {
    setLocation('/c/room-only-color', 'key=k&color=%2310b981');
    captureCreatorIdentityFromFragment();

    expect(getPresenceColor()).toBe('#10b981');
    // Confirmed flag requires BOTH name and color — bug was previously
    // "either value wins." A truncated or tampered URL shouldn't skip
    // the gate on stale room-origin ConfigStore values.
    expect(isRoomIdentityConfirmed('room-only-color')).toBe(false);
    expect(window.location.hash).not.toContain('color=');
  });

  test('only name landed: writes name, does NOT mark confirmed', () => {
    setLocation('/c/room-only-name', 'key=k&name=Bob');
    captureCreatorIdentityFromFragment();

    expect(getIdentity()).toBe('Bob');
    expect(isRoomIdentityConfirmed('room-only-name')).toBe(false);
  });

  test('invalid color (not #RRGGBB): dropped, name still written, NOT confirmed', () => {
    setLocation('/c/room-bad-color', 'name=Carol&color=not-a-color');
    const priorColor = getPresenceColor();
    captureCreatorIdentityFromFragment();

    expect(getIdentity()).toBe('Carol');
    expect(getPresenceColor()).toBe(priorColor);  // unchanged
    expect(isRoomIdentityConfirmed('room-bad-color')).toBe(false);
  });

  test('empty name after trim: dropped, color still written, NOT confirmed', () => {
    setLocation('/c/room-empty-name', 'name=%20%20%20&color=%23eab308');
    captureCreatorIdentityFromFragment();

    expect(getPresenceColor()).toBe('#eab308');
    expect(isRoomIdentityConfirmed('room-empty-name')).toBe(false);
  });

  test('over-long name (>64 chars): rejected', () => {
    const longName = 'x'.repeat(65);
    setLocation('/c/room-long-name', `name=${longName}&color=%232563eb`);
    const priorName = getIdentity();
    captureCreatorIdentityFromFragment();

    expect(getIdentity()).toBe(priorName);  // unchanged
    expect(isRoomIdentityConfirmed('room-long-name')).toBe(false);
  });
});

describe('captureCreatorIdentityFromFragment — path gating', () => {
  test('non-room path: ConfigStore untouched, URL untouched', () => {
    setLocation('/', 'name=Eve&color=%23ef4444');
    const priorName = getIdentity();
    const priorColor = getPresenceColor();
    captureCreatorIdentityFromFragment();

    expect(getIdentity()).toBe(priorName);
    expect(getPresenceColor()).toBe(priorColor);
    // URL rewrite skipped on non-room paths — protects static-share
    // fragments from being corrupted by `URLSearchParams` reformatting.
    expect(window.location.hash).toBe('#name=Eve&color=%23ef4444');
  });

  test('no handoff params: no-op even on room path', () => {
    setLocation('/c/roomX', 'key=k&admin=a');
    captureCreatorIdentityFromFragment();

    expect(isRoomIdentityConfirmed('roomX')).toBe(false);
    // Fragment left alone when we never entered the params branch.
    expect(window.location.hash).toBe('#key=k&admin=a');
  });
});
