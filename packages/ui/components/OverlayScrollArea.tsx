import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ElementType,
  type ReactNode,
} from 'react';
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-react';
import {
  OverlayScrollbars,
  ClickScrollPlugin,
  type EventListeners,
  type PartialOptions,
} from 'overlayscrollbars';
import 'overlayscrollbars/overlayscrollbars.css';

// Register the ClickScrollPlugin once. Without it, `clickScroll: true`
// silently does nothing — only `'instant'` works out of the box.
OverlayScrollbars.plugin(ClickScrollPlugin);

/**
 * Zed/VS Code-style overlay scrollbar wrapper around `overlayscrollbars-react`.
 *
 * - Wide (10px rest, 14px hover), translucent, full-length track
 * - Click anywhere on the track to page-animate toward the click
 * - Fades in on hover / scroll activity, auto-hides after ~800ms idle
 * - No layout shift (overlay, not classic scrollbar)
 * - Honors `prefers-reduced-motion`: no fade, permanently visible
 * - Hidden in print via `print.css`
 *
 * Exposes the library's internal *viewport* element (the node that actually
 * scrolls) via the `onViewportReady` callback (preferred) or an imperative
 * ref handle. Downstream code that needs a scroll container — `IntersectionObserver`
 * roots, scroll event listeners, `scrollTo` / offset math — should consume
 * the viewport from this handle or from `ScrollViewportContext`, never from
 * `document.querySelector('main')`.
 */
export interface OverlayScrollAreaHandle {
  /** The DOM element that actually scrolls, or null before init. */
  getViewport(): HTMLElement | null;
}

export interface OverlayScrollAreaProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** Root element tag (default 'div'). Use 'main' for the primary plan viewport. */
  element?: ElementType;
  children?: ReactNode;
  /**
   * Called when the library's internal viewport element becomes available,
   * and again with `null` when it's torn down. This is the only correct way
   * to get a reference to the scrolling element — it fires from the library's
   * own `initialized` / `destroyed` events, which handle the deferred init
   * timing that ref callbacks cannot observe.
   */
  onViewportReady?: (viewport: HTMLElement | null) => void;
  /** Horizontal overflow behavior (default 'hidden'). */
  overflowX?: 'hidden' | 'scroll' | 'visible';
  /** Vertical overflow behavior (default 'scroll'). */
  overflowY?: 'hidden' | 'scroll' | 'visible';
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

export const OverlayScrollArea = forwardRef<
  OverlayScrollAreaHandle,
  OverlayScrollAreaProps
>(function OverlayScrollArea(
  {
    element = 'div',
    children,
    onViewportReady,
    overflowX = 'hidden',
    overflowY = 'scroll',
    ...rest
  },
  ref,
) {
  const osRef = useRef<OverlayScrollbarsComponentRef<ElementType> | null>(null);
  const lastViewportRef = useRef<HTMLElement | null>(null);

  const getViewport = useCallback((): HTMLElement | null => {
    // Prefer our tracked viewport (delivered via `initialized` event) over
    // asking the imperative handle, which can return null if the consumer
    // reads before the library has finished its deferred init.
    return (
      lastViewportRef.current ??
      osRef.current?.osInstance()?.elements().viewport ??
      null
    );
  }, []);

  useImperativeHandle(ref, () => ({ getViewport }), [getViewport]);

  const reduceMotion = usePrefersReducedMotion();

  const options = useMemo<PartialOptions>(
    () => ({
      scrollbars: {
        theme: 'os-theme-plannotator',
        autoHide: reduceMotion ? 'never' : 'leave',
        autoHideDelay: 800,
        // `true` = animate one page-step toward the click (website-style,
        // requires ClickScrollPlugin registered above). `'instant'` would
        // jump straight to the clicked spot.
        clickScroll: true,
        dragScroll: true,
      },
      overflow: {
        x: overflowX,
        y: overflowY,
      },
    }),
    [overflowX, overflowY, reduceMotion],
  );

  // CRITICAL: deliver the viewport element via the library's own
  // `initialized` / `destroyed` events, NOT via the React ref callback.
  //
  // Why: `OverlayScrollbarsComponent` uses `useImperativeHandle` to expose
  // `{ osInstance, getElement }`. That handle is set during commit, at which
  // point the library's own setup effect has not yet run — so `osInstance()`
  // returns `null`. With `defer: true` it's even worse (setup is queued in
  // `requestIdleCallback`). There is no mechanism to retrigger a React ref
  // callback after the instance finishes initializing.
  //
  // The `events.initialized` handler fires exactly when elements are ready,
  // and `events.destroyed` fires on unmount/teardown. Together they give us
  // the full lifecycle the ref callback can't observe.
  const events = useMemo<EventListeners>(
    () => ({
      initialized: (instance) => {
        const viewport = instance.elements().viewport;
        if (viewport === lastViewportRef.current) return;
        lastViewportRef.current = viewport;
        onViewportReady?.(viewport);
      },
      destroyed: () => {
        if (lastViewportRef.current === null) return;
        lastViewportRef.current = null;
        onViewportReady?.(null);
      },
    }),
    [onViewportReady],
  );

  const handleOsRef = useCallback(
    (node: OverlayScrollbarsComponentRef<ElementType> | null) => {
      osRef.current = node;
    },
    [],
  );

  return (
    <OverlayScrollbarsComponent
      ref={handleOsRef as React.RefCallback<OverlayScrollbarsComponentRef<'div'>>}
      element={element as 'div'}
      options={options}
      events={events}
      defer
      {...rest}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
});
