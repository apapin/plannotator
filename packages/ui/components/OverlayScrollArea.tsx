import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
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
 * - Click anywhere on the track to jump to that position
 * - Fades in on hover / scroll activity, auto-hides after ~800ms idle
 * - No layout shift (overlay, not classic scrollbar)
 * - Honors `prefers-reduced-motion`: no fade, permanently visible
 * - Hidden in print via `print.css`
 *
 * Exposes the library's internal *viewport* element (the node that actually
 * scrolls) via an imperative ref handle. Downstream code that needs a scroll
 * container — `IntersectionObserver` roots, scroll event listeners,
 * `scrollTo` / offset math — should consume the viewport from this handle or
 * from `ScrollViewportContext`, not from `document.querySelector('main')`.
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
  /** Called whenever the viewport element becomes available or changes. */
  onViewportReady?: (viewport: HTMLElement | null) => void;
  /** Horizontal overflow behavior (default 'hidden'). */
  overflowX?: 'hidden' | 'scroll' | 'visible';
  /** Vertical overflow behavior (default 'scroll'). */
  overflowY?: 'hidden' | 'scroll' | 'visible';
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const instance = osRef.current?.osInstance();
    return instance?.elements().viewport ?? null;
  }, []);

  useImperativeHandle(ref, () => ({ getViewport }), [getViewport]);

  // Stable ref callback — React may call it with null (cleanup) then with
  // the new node. We notify the parent only when the resolved viewport
  // element changes, to avoid triggering parent state updates in a loop.
  const handleOsRef = useCallback(
    (node: OverlayScrollbarsComponentRef<ElementType> | null) => {
      osRef.current = node;
      const viewport = node?.osInstance()?.elements().viewport ?? null;
      if (viewport !== lastViewportRef.current) {
        lastViewportRef.current = viewport;
        onViewportReady?.(viewport);
      }
    },
    [onViewportReady],
  );

  const options = useMemo<PartialOptions>(
    () => ({
      scrollbars: {
        theme: 'os-theme-plannotator',
        autoHide: prefersReducedMotion() ? 'never' : 'leave',
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
    [overflowX, overflowY],
  );

  return (
    <OverlayScrollbarsComponent
      ref={handleOsRef as never}
      element={element as 'div'}
      options={options}
      defer
      {...rest}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
});
