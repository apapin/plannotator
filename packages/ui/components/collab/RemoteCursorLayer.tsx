import React, { useEffect, useMemo, useRef } from 'react';
import type { PresenceState, CursorState } from '@plannotator/shared/collab';
import { isAgentIdentity } from '@plannotator/ui/utils/agentIdentity';

/**
 * Absolute-positioned overlay that renders remote cursor flags. Parent
 * mounts this as a sibling of the Viewer inside the scroll viewport so
 * cursors scroll with content without any extra math.
 *
 * Rendering model:
 *   - One `<div>` per remote client; mount/unmount is React-driven so
 *     adds/removes during a session update cleanly.
 *   - Position is NOT React state. A single `requestAnimationFrame`
 *     loop reads the latest target from `remotePresence`/`containerRect`
 *     refs, lerps each cursor's current position toward its target, and
 *     mutates `transform` on the DOM node directly. This matches the
 *     industry pattern used by Figma-style / Liveblocks-style cursor
 *     systems — avoids React reconciliation on every frame (~60Hz * N
 *     cursors would otherwise churn the scheduler for nothing) and
 *     leans on the GPU compositor for `translate3d`.
 *
 * Smoothing:
 *   - Latest-wins target per clientId. On each frame: lerp toward target
 *     with a fixed alpha (~0.3 feels responsive without overshoot).
 *   - Snap (bypass lerp) when:
 *       1. First frame for a clientId — avoid sliding from (0,0).
 *       2. Cursor reappears after going null/idle — treat like first.
 *       3. Single-frame distance > SNAP_THRESHOLD — usually a
 *          coordinate-space flip (block ↔ viewport) or scroll jump,
 *          where animating the "swoosh" would look worse than snapping.
 *
 * Offscreen indicators:
 *   - When a cursor's resolved position falls outside the overlay
 *     container rect, the same element is repurposed as a small edge
 *     label (`↑ Alice` / `↓ Alice`) pinned to the nearest edge and
 *     clamped horizontally. Tells the reader "they're somewhere else
 *     in the doc" instead of letting the cursor vanish.
 *
 * Coordinate model (matches the protocol's `CursorState`):
 *   - `coordinateSpace: 'document'` — (x, y) in scroll-document coords.
 *     Render at (x - scrollX, y - scrollY) within the viewport.
 *   - `coordinateSpace: 'viewport'` — (x, y) in viewport coords.
 *     Rendered as-is minus the container offset.
 *   - `coordinateSpace: 'block'` — relative to the block's bounding
 *     rect, identified by `blockId`. Resolved via `[data-block-id=…]`.
 *
 * Local cursor is NOT rendered — that cursor is the browser's own caret.
 */

export interface RemoteCursorLayerProps {
  remotePresence: Record<string, PresenceState>;
  /**
   * Bounding rect of the overlay container in viewport coords. Used to
   * translate viewport-space cursor coords into overlay-local coords
   * and to decide whether a cursor is onscreen vs. pinned to an edge.
   */
  containerRect: DOMRect | null;
  /** ParentNode to search within for block elements. Defaults to document. */
  root?: ParentNode;
  className?: string;
}

interface CursorRenderState {
  displayX: number;
  displayY: number;
  /** True once we've ever painted this cursor; toggled off on idle. */
  everRendered: boolean;
}

function findBlockRect(blockId: string, root: ParentNode): DOMRect | null {
  // `blockId` arrives as decrypted remote presence. The bundled UI only
  // emits real `data-block-id` values, but anything holding the room URL +
  // key (direct WebSocket client, modified console, agent) can send an
  // arbitrary string. A newline or other CSS-invalid character makes the
  // selector throw `SyntaxError` during render, taking the whole cursor
  // layer down for every participant. Escape safely and swallow any
  // residual selector failures so bad remote input just drops the cursor.
  try {
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(blockId)
        : blockId.replace(/["\\]/g, '\\$&');
    const el = root.querySelector(`[data-block-id="${escaped}"]`) as HTMLElement | null;
    return el ? el.getBoundingClientRect() : null;
  } catch {
    return null;
  }
}

/**
 * Find the plan's scroll viewport element. App tags it with
 * `data-plan-scroll-viewport` when the OverlayScrollbars instance
 * settles. Used to resolve `document`-space cursors (protocol supports
 * all three coordinate spaces) — the bundled UI's LocalPresenceEmitter
 * emits `block`-space with a sticky anchor, but a direct-agent or
 * future client could still use `document`, and the layer handles
 * both uniformly via `resolveCursor` below.
 *
 * Fall-through to `null` is safe — the caller skips rendering when
 * `resolveCursor` returns null, so the cursor waits for the scroll
 * area to mount instead of rendering at a garbage position.
 */
function findScrollViewport(): HTMLElement | null {
  return typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('[data-plan-scroll-viewport]')
    : null;
}

function resolveCursor(
  cursor: CursorState,
  root: ParentNode,
): { viewportX: number; viewportY: number } | null {
  switch (cursor.coordinateSpace) {
    case 'viewport':
      return { viewportX: cursor.x, viewportY: cursor.y };
    case 'document': {
      // Content-space: cursor.(x, y) is relative to the scroll
      // container's inner content origin. Map to this viewer's
      // viewport by re-applying their scroll container rect and
      // current scroll position.
      const vp = findScrollViewport();
      if (!vp) return null;
      const rect = vp.getBoundingClientRect();
      return {
        viewportX: rect.left + cursor.x - vp.scrollLeft,
        viewportY: rect.top  + cursor.y - vp.scrollTop,
      };
    }
    case 'block': {
      // The bundled UI's LocalPresenceEmitter writes block-space with
      // a sticky anchor (same block until the pointer crosses into a
      // new one), so this is the hot path for same-app peers. Also
      // honors direct-agent clients that send block coords.
      if (!cursor.blockId) return null;
      const blockRect = findBlockRect(cursor.blockId, root);
      if (!blockRect) return null;
      return {
        viewportX: blockRect.left + cursor.x,
        viewportY: blockRect.top + cursor.y,
      };
    }
    default:
      return null;
  }
}

// Line-height fallback for cursor caret — we don't know the remote
// user's line-height at the cursor, and resolving per-block metrics on
// every update would be expensive. 18px covers standard body copy.
const CURSOR_HEIGHT_PX = 18;

// Smoothing tuning. See component docstring.
const LERP_ALPHA = 0.3;
const SNAP_THRESHOLD_PX = 600;

/**
 * Inset applied when clamping an offscreen cursor to the container
 * edge. Keeps the pinned glyph fully visible instead of clipping half
 * of it against the edge.
 */
const EDGE_INSET_PX = 8;

export function RemoteCursorLayer({
  remotePresence,
  containerRect,
  root = typeof document !== 'undefined' ? document : undefined as unknown as ParentNode,
  className = '',
}: RemoteCursorLayerProps): React.ReactElement | null {
  // Refs the rAF loop reads. React updates these on every prop change;
  // the loop picks up the latest values on its next frame without
  // depending on React render cycles for motion.
  const presenceRef = useRef(remotePresence);
  presenceRef.current = remotePresence;
  const containerRectRef = useRef(containerRect);
  containerRectRef.current = containerRect;
  const rootRef = useRef(root);
  rootRef.current = root;

  const renderStatesRef = useRef<Map<string, CursorRenderState>>(new Map());
  const nodeRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Gate the animation loop on actually having remote cursors to draw.
  // Solo rooms (the common case) would otherwise run a 60Hz no-op loop
  // for every session. Effect restarts only when this boolean flips
  // empty↔non-empty, so continuous cursor updates during a busy session
  // don't retear the loop down.
  const hasRemoteCursors = Object.keys(remotePresence).length > 0;

  useEffect(() => {
    if (!hasRemoteCursors) return;
    let rafId = 0;

    const tick = () => {
      const presence = presenceRef.current;
      const rect = containerRectRef.current;
      const rootEl = rootRef.current ?? (typeof document !== 'undefined' ? document : null);
      if (!rootEl) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const states = renderStatesRef.current;
      const nodes = nodeRefsRef.current;

      // Drop render state for cursors no longer in presence. The node
      // itself is unmounted by React on the next render — we just
      // release our tracking so a rejoin starts fresh (snap).
      for (const id of Array.from(states.keys())) {
        if (!(id in presence)) {
          states.delete(id);
        }
      }

      for (const [clientId, p] of Object.entries(presence)) {
        const node = nodes.get(clientId);
        if (!node) continue;  // React hasn't committed the element yet.

        const resolved = p.cursor ? resolveCursor(p.cursor, rootEl) : null;
        if (!resolved) {
          // Null / unresolvable cursor — mark idle and hide. Next
          // non-null packet snaps back in from the new position instead
          // of sliding from wherever the ghost was left.
          node.style.display = 'none';
          const prev = states.get(clientId);
          if (prev) prev.everRendered = false;
          continue;
        }

        // Target in overlay-local space.
        const targetX = resolved.viewportX - (rect?.left ?? 0);
        const targetY = resolved.viewportY - (rect?.top ?? 0);

        let state = states.get(clientId);
        if (!state || !state.everRendered) {
          // First paint for this clientId (or just came back from
          // idle): snap so we don't see a slide from (0,0) or the
          // previous stale position.
          state = { displayX: targetX, displayY: targetY, everRendered: true };
          states.set(clientId, state);
        } else {
          const dx = targetX - state.displayX;
          const dy = targetY - state.displayY;
          if (Math.hypot(dx, dy) > SNAP_THRESHOLD_PX) {
            // Huge single-frame jump — usually a block↔viewport
            // coordinate flip or a scroll that moved the block rect
            // hundreds of pixels. Animating it looks like a
            // full-screen swoosh; snap instead.
            state.displayX = targetX;
            state.displayY = targetY;
          } else {
            state.displayX += dx * LERP_ALPHA;
            state.displayY += dy * LERP_ALPHA;
          }
        }

        // Onscreen check against the overlay container bounds. The
        // container IS the editor viewport in our current layout, so
        // "outside container" == "outside visible editor" == pin to
        // the nearest edge.
        const containerWidth = rect?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
        const containerHeight = rect?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
        const above = state.displayY < 0;
        const below = state.displayY > containerHeight;
        const leftOf = state.displayX < 0;
        const rightOf = state.displayX > containerWidth;
        const offscreen = above || below || leftOf || rightOf;

        let renderX = state.displayX;
        let renderY = state.displayY;
        let edgeDirection: 'none' | 'above' | 'below' | 'left' | 'right' = 'none';
        if (offscreen) {
          // Clamp to the nearest edge with a small inset so the glyph
          // stays fully visible. Direction picks vertical over
          // horizontal because most scrolling is vertical; a corner-
          // case cursor gets the vertical indicator with horizontal
          // clamping applied for position.
          renderX = Math.max(EDGE_INSET_PX, Math.min(containerWidth - EDGE_INSET_PX, state.displayX));
          renderY = Math.max(EDGE_INSET_PX, Math.min(containerHeight - EDGE_INSET_PX, state.displayY));
          edgeDirection = above ? 'above' : below ? 'below' : leftOf ? 'left' : 'right';
        }

        node.style.display = '';
        node.style.transform = `translate3d(${renderX}px, ${renderY}px, 0)`;

        // Toggle the visual via dataset — CSS (below) swaps caret vs.
        // edge indicator based on `data-edge-direction`.
        if (node.dataset.edgeDirection !== edgeDirection) {
          node.dataset.edgeDirection = edgeDirection;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hasRemoteCursors]);

  // React owns the set of mounted cursor nodes (keyed by clientId).
  // The rAF loop positions them. Recomputed each render — trivial cost
  // and keeps the list stable in key order so React doesn't reorder
  // DOM nodes when presence iteration order shifts.
  const clientIds = useMemo(
    () => Object.keys(remotePresence).sort(),
    // `remotePresence` is a new object each state emit, but its key
    // set changes rarely; depending on the whole object is fine given
    // the sort is O(n log n) on tiny n.
    [remotePresence],
  );

  if (clientIds.length === 0) return null;

  return (
    <div
      className={`pointer-events-none absolute inset-0 ${className}`}
      data-testid="remote-cursor-layer"
      aria-hidden
    >
      {/*
        Self-contained style block. Keeps the swap between onscreen
        caret and offscreen edge-pin pure CSS, driven by the
        `data-edge-direction` attribute the rAF loop mutates on each
        cursor node.
        .remote-cursor-offscreen is default-hidden via CSS here
        (NOT via inline `style={{ display: 'flex' }}` on the element)
        because inline styles beat stylesheet rules — with an inline
        default of flex, the `data-edge-direction="none"` rule that
        tries to hide the pill would lose and both variants would
        paint on every cursor.
      */}
      <style>{`
        .remote-cursor-offscreen {
          display: none;
          align-items: center;
          gap: 2px;
        }
        .remote-cursor:not([data-edge-direction="none"]) .remote-cursor-onscreen { display: none; }
        .remote-cursor:not([data-edge-direction="none"]) .remote-cursor-offscreen { display: flex; }
        .remote-cursor[data-edge-direction="above"] .remote-cursor-arrow::before { content: "↑"; }
        .remote-cursor[data-edge-direction="below"] .remote-cursor-arrow::before { content: "↓"; }
        .remote-cursor[data-edge-direction="left"]  .remote-cursor-arrow::before { content: "←"; }
        .remote-cursor[data-edge-direction="right"] .remote-cursor-arrow::before { content: "→"; }
      `}</style>
      {clientIds.map(clientId => {
        const p = remotePresence[clientId];
        const name = p?.user?.name ?? 'Guest';
        const color = p?.user?.color ?? '#888';
        const isAgent = isAgentIdentity(p?.user?.name);
        return (
          <RemoteCursor
            key={clientId}
            clientId={clientId}
            name={name}
            color={color}
            isAgent={isAgent}
            nodeRefsRef={nodeRefsRef}
          />
        );
      })}
    </div>
  );
}

/**
 * Single cursor glyph. Position is NEVER set here — the parent's rAF
 * loop mutates `transform` and `data-edge-direction` on the node
 * directly via the shared ref map. This component only owns the
 * static-per-client bits: color, name, and the SVG/label markup.
 *
 * Contains both the normal caret+label and the offscreen edge-pin
 * variants in the DOM; CSS selectors on the parent's `data-edge-*`
 * dataset decide which is visible. Keeps motion allocation-free
 * since the DOM structure never changes during animation.
 */
function RemoteCursor({
  clientId,
  name,
  color,
  isAgent,
  nodeRefsRef,
}: {
  clientId: string;
  name: string;
  color: string;
  isAgent: boolean;
  nodeRefsRef: React.RefObject<Map<string, HTMLDivElement>>;
}): React.ReactElement {
  // Callback ref keyed by clientId. Each mount/unmount registers or
  // releases in the shared ref map that the rAF loop reads.
  const setRef = (el: HTMLDivElement | null) => {
    const map = nodeRefsRef.current;
    if (!map) return;
    if (el) map.set(clientId, el);
    else map.delete(clientId);
  };

  return (
    <div
      ref={setRef}
      data-client-id={clientId}
      data-client-kind={isAgent ? 'agent' : 'human'}
      data-edge-direction="none"
      className="remote-cursor absolute top-0 left-0 will-change-transform"
      style={{ display: 'none' }}  // hidden until the first rAF tick resolves position
    >
      {/* Onscreen: vertical caret bar + name label. */}
      <div className="remote-cursor-onscreen">
        <div
          style={{
            width: 2,
            height: CURSOR_HEIGHT_PX,
            backgroundColor: color,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 4,
            backgroundColor: color,
            color: '#fff',
            fontSize: 10,
            padding: '1px 4px',
            borderRadius: 2,
            whiteSpace: 'nowrap',
            lineHeight: 1.2,
          }}
        >
          {isAgent && <span aria-hidden style={{ marginRight: 3 }}>⚙</span>}
          {name}
        </div>
      </div>
      {/* Offscreen: single colored pill with directional arrow. CSS
          hides this when `data-edge-direction="none"` and swaps the
          arrow glyph based on direction. */}
      <div
        className="remote-cursor-offscreen"
        // `display` deliberately OMITTED from inline style — it's
        // owned by the stylesheet block in the parent layer so the
        // `data-edge-direction` swap can win. Other visual props
        // remain inline (color is dynamic per peer, rest is layout).
        style={{
          backgroundColor: color,
          color: '#fff',
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 10,
          whiteSpace: 'nowrap',
          lineHeight: 1.2,
        }}
      >
        <span className="remote-cursor-arrow" aria-hidden>
          {/* Placeholder; CSS rewrites via ::before based on direction. */}
        </span>
        {isAgent && <span aria-hidden style={{ marginRight: 3 }}>⚙</span>}
        <span>{name}</span>
      </div>
    </div>
  );
}
