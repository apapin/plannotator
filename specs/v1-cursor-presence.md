# Live Rooms — Cursor Presence

How remote cursors are positioned in Plannotator Live Rooms, why the
implementation took three passes to land, and the invariants anyone
touching `LocalPresenceEmitter` or `RemoteCursorLayer` should preserve.

## Problem

Two participants looking at the same plan in a live room may be viewing
it with different window widths, zoom levels, fonts, or scroll
positions. A remote cursor has to resolve to the *same semantic
location* in the document regardless of those differences. Our first
two attempts both failed at this; the third works.

The semantic location is "Alice's pointer is over paragraph 5, ~30px
from its start." Anything coarser (viewport pixel coords) fails when
reflow shifts paragraphs between participants. Anything that naïvely
chases the pointer across the document structure produces visible
jumps at content boundaries.

## What we tried

### Attempt 1: block + viewport hybrid

Emit `coordinateSpace: 'block'` with `(x, y)` relative to the paragraph
under the pointer when over one; fall back to `coordinateSpace: 'viewport'`
with raw client coordinates when over whitespace, headers, or gaps.

Receiver's `resolveCursor` handles both spaces and maps each to its
local viewport.

**Why it failed.** Each participant's DOM places paragraphs at
different viewport positions. When Alice's pointer moved from block-42
to block-43, Bob's rendering had to teleport from "20px into Bob's
block-42" to "5px into Bob's block-43" — two positions that could be
hundreds of pixels apart in Bob's viewport because of reflow-induced
layout divergence. The remote cursor flashed violently at every
content boundary crossing. Our snap-on-huge-jump safeguard (>600px in
one frame) kept firing in normal mouse motion, making the "jumps" a
literal teleport rather than a visible swoosh.

### Attempt 2: content coordinates

Treat the scroll container's inner content as a single coordinate
space. Sender emits `contentX = clientX - scrollVP.left + scrollVP.scrollLeft`,
same for Y. Receiver reverses: `viewportX = rect.left + contentX - scrollLeft`.

This worked well for motion — smooth, no block-boundary snaps, no
coordinate-space flips. The rAF loop had almost no reason to snap. But
positions were **wrong**.

**Why it failed.** The document reflows. Alice's window is 1200px
wide; paragraphs wrap twice. Bob's window is 900px wide; the same
paragraphs wrap three times. Content-y=5000 for Alice is paragraph
15's fourth line. Content-y=5000 for Bob is paragraph 11's sixth line.
Pixel y-values in a reflowing document are not shared truth. Alice's
cursor landed over the wrong paragraph on Bob's screen — smoothly, but
wrong.

### Attempt 3: sticky block anchor (shipped)

Go back to block-anchored coordinates (the only coordinate that
survives reflow) but make the anchor *sticky*: once the pointer
selects a block, keep that block as the anchor until the pointer
demonstrably lands on a different one. Whitespace, gaps, and
non-block elements inside the scroll viewport reuse the last anchor
with overflowed `(x, y)` — the pointer's pixel offset from the
anchor's top-left, even if `y` is negative (above the block) or
greater than `block.height` (below).

**Why it works.** Every emit is in one coordinate system (block
coordinates), so there are no cross-space flips. The only remaining
discontinuity happens at the exact moment the anchor switches —
pointer genuinely entering a new block — and the jump size is
bounded by the gap between two consecutive blocks in the rendered
document (~line-height, 10–30px). That's:

- Well below the 600px snap threshold, so lerp absorbs it.
- Similar between Alice's and Bob's DOMs since both render the same
  CSS; the *difference* in gap size between participants is a few
  pixels at most, which is imperceptible once smoothed.
- Semantically correct: when Alice's pointer entered block-43, Bob's
  cursor also lands on Bob's block-43, which is the same paragraph.

## Shipped algorithm

### Sender (`LocalPresenceEmitter` in `packages/editor/RoomApp.tsx`)

On every `pointermove`:

1. Find the plan scroll viewport (see "Scroll viewport lookup" below).
   If not yet mounted, bail.
2. If the pointer is outside the viewport's bounding rect (header,
   room menu, chrome), bail. The last cursor value stays on the wire;
   remote peers see the cursor frozen at its last in-content spot.
3. Find the nearest ancestor with `data-block-id`. If found, use it
   as the new anchor.
4. If not found and a previous anchor exists in ref state, re-query
   that block from the DOM and reuse it. If the previous anchor block
   is gone (should be rare — plans don't mutate inside a room), bail.
5. If no anchor at all (empty plan, very first move before any block
   was visited), bail.
6. Emit `{ blockId, x: clientX - blockRect.left, y: clientY - blockRect.top, coordinateSpace: 'block' }`.
   `(x, y)` may be negative or exceed block dimensions — that's the
   point.

On `window.blur` or `document.hidden`, emit `cursor: null` and reset
the sticky anchor. The presence TTL sweep handles senders that go
silent without firing those events.

Send cadence: 33ms trailing throttle (~30Hz), matching Excalidraw's
`CURSOR_SYNC_TIMEOUT`. Latest-wins, lossy, encrypted with the room's
`presenceKey`.

### Receiver (`resolveCursor` in `packages/ui/components/collab/RemoteCursorLayer.tsx`)

The `'block'` branch is unchanged from the original protocol:

```ts
const blockRect = findBlockRect(cursor.blockId, root);
if (!blockRect) return null;
return {
  viewportX: blockRect.left + cursor.x,
  viewportY: blockRect.top + cursor.y,
};
```

Negative `(x, y)` or overflow beyond the block's dimensions just
adds/subtracts from the block's rect — producing cursor positions in
the whitespace around the block naturally.

The `'viewport'` and `'document'` branches are kept in the receiver
for protocol completeness (direct-agent clients or future senders may
use them) but the bundled UI no longer emits them.

### Rendering (`RemoteCursorLayer`)

Rendering is independent of the coordinate model. Per-cursor state
lives in a ref map, not React state; a single `requestAnimationFrame`
loop lerps each cursor's current position toward its target at
α=0.3, snapping on first appearance / reappearance after idle / a
single-frame distance greater than 600px. Positions are written
directly to DOM via `element.style.transform = translate3d(...)` so
React never re-renders for motion.

Offscreen cursors (target outside the overlay container rect) clamp
to the nearest edge with an 8px inset and swap to a directional pill
(`↑ Alice` / `↓ Alice` / `← Alice` / `→ Alice`) driven by
`data-edge-direction` on the node and a small inline `<style>`
block in the component.

The rAF loop is gated on `Object.keys(remotePresence).length > 0`
so solo rooms don't run a no-op 60Hz loop.

## Scroll viewport lookup

`LocalPresenceEmitter` and `RemoteCursorLayer` both need the plan's
scroll viewport element — the emitter to decide "is the pointer
inside the content area?", the layer to resolve `'document'` coords
for any non-UI senders. The element is owned by `App` via
`useOverlayViewport()` and exposed through `ScrollViewportContext`,
but both components are React-siblings of `App` in `RoomApp` and
can't consume the context directly.

Rather than lift them into App's tree (bigger refactor), App tags
the viewport element with `data-plan-scroll-viewport` in a
`useEffect`, and both components `document.querySelector` for it at
use time. One element per page; the coupling is documented at both
ends.

The alternative refactor — moving `LocalPresenceEmitter` and
`RemoteCursorLayer` into App and passing the scroll viewport as a
prop — is a reasonable follow-up if anyone wants to eliminate the
DOM-query coupling. Nothing else in the design depends on their
current location in RoomApp.

## Invariants

Preserve these if you change anything in this pipeline:

- **One coordinate system on the wire.** The emit side must never
  interleave `'block'` with `'viewport'` or `'document'` in the same
  session. Receivers handle all three, but mixing on emit produces
  the cross-space jumps that Attempt 1 suffered from.
- **Sticky anchor.** Never switch anchor blocks faster than the
  pointer crosses block boundaries. Chasing blocks on every
  pointermove reintroduces boundary flicker.
- **Overflow `(x, y)` is normal.** Do not clamp to block bounds —
  the whitespace tracing relies on negative/overflow values.
- **Skip, don't null, outside the scroll viewport.** Header / menu
  use by the sender should not clear their cursor for peers.
  `cursor: null` is reserved for genuine leave (blur / tab hidden).
- **33ms send cadence.** Higher is wasteful for this data; lower is
  noticeable lag. If you change it, measure.
- **Lerp the receive side, snap only on threshold.** Don't render
  raw packets — that's Attempt 1's pre-smoothing failure mode.
- **Keep rendering imperative.** Motion through React state will
  reconcile the cursor layer at 60Hz × N peers; mutate transform
  directly via refs.

## References

- [Liveblocks — How to animate multiplayer cursors](https://liveblocks.io/blog/how-to-animate-multiplayer-cursors)
- [Liveblocks live cursors tutorial](https://liveblocks.io/docs/tutorial/react/getting-started/live-cursors)
- [Excalidraw collaboration constants](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/app_constants.ts)
- [Excalidraw cursor throttle](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx)
- [Yjs Awareness & Presence](https://docs.yjs.dev/getting-started/adding-awareness)
- [perfect-cursors (tldraw) — spline interpolation library](https://github.com/steveruizok/perfect-cursors)
- [Building Figma Multiplayer Cursors — Mark Skelton](https://mskelton.dev/blog/building-figma-multiplayer-cursors)

## Out of scope for V1

- **Spline interpolation.** Lerp α=0.3 is enough in testing; we'd
  reach for `perfect-cursors` only if the simple lerp stops feeling
  right at higher peer counts.
- **Follow mode / visible-range broadcast.** Knowing what part of
  the document a peer is viewing and being able to jump to it is a
  later slice; the edge indicators cover the "they're elsewhere"
  case for now.
- **Horizontal overflow indicators.** Left/right edge pinning is
  implemented but unlikely to fire given Plannotator is primarily a
  vertical-scroll document; tested lightly.
- **Content-coordinate emission for non-document agents.** If a
  direct-agent client wanted to place a cursor outside any block
  (e.g., at a computed document position), it could emit
  `coordinateSpace: 'document'` and the receiver would resolve
  through the scroll viewport correctly. The UI does not do this.
