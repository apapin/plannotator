/**
 * Read-only transition tests for useAnnotationHighlighter.
 *
 * Strategy: mock @plannotator/web-highlighter so we can trigger the
 * CREATE event deterministically with a synthetic source. That seeds
 * toolbarState + pendingSourceRef exactly the way a real text selection
 * would, without depending on happy-dom's Selection/Range behavior.
 * Then we flip `readOnly` true and strictly assert:
 *
 *   - `toolbarState`, `commentPopover`, `quickLabelPicker` are null
 *   - the mocked `highlighter.remove(sourceId)` was called on the
 *     pending source (not just on any id)
 *
 * The mock.module call must run before the hook is imported so bun's
 * module graph resolves to our stub; the test therefore defers the
 * hook import to inside the describe via `await import(...)`.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';

type CreateListener = (payload: { sources: Array<{ id: string; text: string; startMeta?: unknown; endMeta?: unknown }> }) => void;
type ClickListener = (payload: { id: string }) => void;

interface FakeHighlighter {
  on(event: unknown, fn: CreateListener | ClickListener): void;
  off?: (...args: unknown[]) => void;
  remove: ReturnType<typeof mock>;
  addClass: ReturnType<typeof mock>;
  getDoms: (id: string) => HTMLElement[] | null;
  run: () => void;
  fromRange: (range: Range) => void;
  dispose: () => void;
}

// Captured across test instances so each test can assert on the mock.
// The hook instantiates ONE Highlighter per mount, so capturing the
// most-recent instance is sufficient.
let lastHighlighter: FakeHighlighter | null = null;
let lastCreateListener: CreateListener | null = null;

class FakeHighlighterImpl implements FakeHighlighter {
  remove = mock((_id: string) => {});
  addClass = mock((_cls: string, _id: string) => {});
  constructor(_opts: unknown) {
    lastHighlighter = this;
  }
  on(event: unknown, fn: CreateListener | ClickListener): void {
    // The hook listens for CREATE and CLICK; Highlighter.event.CREATE is
    // exposed on the class via a static enum. We discriminate by the
    // function shape we get passed at runtime — CREATE takes `{ sources }`,
    // CLICK takes `{ id }`. For our purposes capturing the CREATE
    // listener (first .on call) is what matters.
    void event;
    if (!lastCreateListener) {
      lastCreateListener = fn as CreateListener;
    }
  }
  getDoms(_id: string) {
    // Return a truthy DOM node so the CREATE handler progresses past
    // the `doms?.length > 0` gate and sets toolbarState.
    const el = document.createElement('span');
    return [el];
  }
  run() { /* no-op */ }
  fromRange(_range: Range) { /* no-op */ }
  dispose() { /* no-op */ }
}

// Static event enum the hook reads as `Highlighter.event.CREATE`.
(FakeHighlighterImpl as unknown as { event: Record<string, string> }).event = {
  CREATE: 'create',
  CLICK: 'click',
};

// Mock must be registered before the hook module is imported.
mock.module('@plannotator/web-highlighter', () => ({
  default: FakeHighlighterImpl,
}));

describe('useAnnotationHighlighter — readOnly transition', () => {
  test('seeded toolbarState is cleared AND highlighter.remove is called on readOnly flip', async () => {
    // Defer the hook import so mock.module is already in effect.
    const { useAnnotationHighlighter } = await import('./useAnnotationHighlighter');

    lastHighlighter = null;
    lastCreateListener = null;

    const host = document.createElement('div');
    host.innerHTML = '<p data-block-id="b1">hello world</p>';
    document.body.appendChild(host);

    const { result, rerender, unmount } = renderHook(
      ({ readOnly }: { readOnly: boolean }) => {
        const containerRef = useRef<HTMLDivElement>(host as unknown as HTMLDivElement);
        return useAnnotationHighlighter({
          containerRef,
          annotations: [],
          selectedAnnotationId: null,
          mode: 'selection',
          readOnly,
        });
      },
      { initialProps: { readOnly: false } },
    );

    // The init effect should have constructed our FakeHighlighter and
    // captured its CREATE listener. If this ever regresses (e.g., the
    // hook starts listening on a different event), the assertion fires
    // before the weaker parts of the test can hide the break.
    expect(lastHighlighter).not.toBeNull();
    expect(lastCreateListener).not.toBeNull();

    const sourceId = 'synthetic-source-1';
    await act(async () => {
      lastCreateListener!({
        sources: [{ id: sourceId, text: 'hello' }],
      });
    });

    // Strict: toolbarState MUST be populated after the CREATE fire.
    // Any regression in the CREATE handler will fail here rather than
    // being silently absorbed by an optional branch.
    expect(result.current.toolbarState).not.toBeNull();

    await act(async () => { rerender({ readOnly: true }); });

    expect(result.current.toolbarState).toBeNull();
    expect(result.current.commentPopover).toBeNull();
    expect(result.current.quickLabelPicker).toBeNull();

    // The transition effect must have invoked highlighter.remove with
    // the pending source's id, not just cleared React state. Without
    // this, the <mark> the real library would have injected into the
    // DOM remains as a ghost annotation.
    expect(lastHighlighter!.remove).toHaveBeenCalledWith(sourceId);

    unmount();
    document.body.innerHTML = '';
  });

  test('readOnly false → true → false → true cycles do not crash or leak', async () => {
    const { useAnnotationHighlighter } = await import('./useAnnotationHighlighter');

    lastHighlighter = null;
    lastCreateListener = null;

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { result, rerender, unmount } = renderHook(
      ({ readOnly }: { readOnly: boolean }) => {
        const containerRef = useRef<HTMLDivElement>(host as unknown as HTMLDivElement);
        return useAnnotationHighlighter({
          containerRef,
          annotations: [],
          selectedAnnotationId: null,
          mode: 'selection',
          readOnly,
        });
      },
      { initialProps: { readOnly: false } },
    );

    await act(async () => { rerender({ readOnly: true }); });
    await act(async () => { rerender({ readOnly: false }); });
    await act(async () => { rerender({ readOnly: true }); });

    expect(result.current.toolbarState).toBeNull();
    expect(result.current.commentPopover).toBeNull();
    expect(result.current.quickLabelPicker).toBeNull();
    expect(typeof result.current.handleAnnotate).toBe('function');
    expect(typeof result.current.handleToolbarClose).toBe('function');

    unmount();
    document.body.innerHTML = '';
  });
});
