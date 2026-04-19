/**
 * RoomApp — the room-mode shell that wraps the existing <App>.
 *
 * Responsibilities:
 * - Parse the room URL (already done by AppRoot; passed in as props).
 * - Render the identity gate until the participant has picked name + color.
 * - Mount useCollabRoomSession({ intent: 'join', ... }) after the gate.
 * - Render the RemoteCursorLayer overlay and the LocalPresenceEmitter
 *   around <App>.
 * - Show a terminal "room no longer available" screen when the room is
 *   deleted or expired.
 *
 * Explicitly NOT done here:
 * - Room header UI — `RoomHeaderControls` lives in the editor header
 *   and is owned by `App.tsx`. That's also where lock/unlock/delete,
 *   copy links, and copy consolidated feedback originate.
 * - Image-stripped notice and stripped-image count handoff — moved to
 *   `App.tsx` so the banner renders directly under the editor header
 *   instead of as a stacked floating card.
 * - Approve/Deny — local-only, never offered in room mode; the room
 *   tab has no cross-origin path to the blocked agent hook.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollabRoomSession } from '@plannotator/ui/hooks/collab/useCollabRoomSession';
import { usePresenceThrottle } from '@plannotator/ui/hooks/collab/usePresenceThrottle';
import { RemoteCursorLayer } from '@plannotator/ui/components/collab/RemoteCursorLayer';
import { JoinRoomGate } from '@plannotator/ui/components/collab/JoinRoomGate';
import { loadAdminSecret } from '@plannotator/ui/utils/adminSecretStorage';
import {
  getIdentity,
  setCustomIdentity,
  getPresenceColor,
  setPresenceColor,
} from '@plannotator/ui/utils/identity';
import {
  isRoomIdentityConfirmed,
  markRoomIdentityConfirmed,
} from '@plannotator/ui/utils/roomIdentityConfirmed';
import type { CollabRoomUser } from '@plannotator/shared/collab/client';
import type { PresenceState, CursorState } from '@plannotator/shared/collab';

export interface RoomAppProps {
  roomId: string;
  url: string;
  /**
   * Whether this tab started from a local editor session (creator flow) or
   * opened the /c/:roomId URL cold (participant flow). Drives the delete
   * success behavior: creator falls back to local mode; participant sees
   * the terminal screen.
   */
  originatedLocally: boolean;
  /** Children = the existing <App> component; wrapped so it becomes room-aware via props. */
  renderEditor(args: {
    roomSession: ReturnType<typeof useCollabRoomSession>;
  }): React.ReactNode;
}

/**
 * Generate a high-entropy internal id for a participant. Not rendered —
 * cursor labels and avatars pull from `user.name` (the display name the
 * participant typed). Used as an opaque handle inside this tab so
 * anything that stores per-id state (future sessionStorage-backed UI)
 * doesn't collide when two participants picked the same display name.
 */
function generateParticipantId(): string {
  // `crypto.randomUUID()` is available in every browser the editor
  // supports (Chrome 92+, Firefox 95+, Safari 15.4+).
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `guest-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function RoomApp({
  roomId,
  url,
  originatedLocally,
  renderEditor,
}: RoomAppProps): React.ReactElement {
  // Skip the join gate when we already have a confirmed identity for
  // THIS room in this tab. The flag is set by:
  //   - `AppRoot` on creator arrival (consumed the `&name=&color=`
  //     fragment handoff).
  //   - `handleJoin` below after a participant submits the gate.
  //
  // `useState` initializer runs synchronously on first render so the
  // gate never flashes when the flag is already set. A different room
  // URL in the same tab lands here with `isRoomIdentityConfirmed(...)`
  // returning false for that new roomId, so the user re-confirms per
  // room (the agreed UX — allows per-room color tweaks).
  const [identity, setIdentity] = useState<CollabRoomUser | null>(() => {
    if (typeof window === 'undefined') return null;
    if (!isRoomIdentityConfirmed(roomId)) return null;
    return {
      id: generateParticipantId(),
      name: getIdentity(),
      color: getPresenceColor(),
    };
  });
  // Local cursor state used to live here, but a ~20Hz pointermove-driven
  // setState at RoomApp's top level rerendered the whole editor tree
  // (renderEditor's inline arrow in AppRoot produces a fresh <App/>
  // element on every parent render, and App isn't React.memo'd). It now
  // lives inside `LocalPresenceEmitter` — a null-rendering sibling of
  // the editor — so pointer moves only reconcile that tiny subtree.
  // Latches to true the first time the client reaches `connectionStatus:
  // 'authenticated'` and never clears. Once set, a transient socket drop
  // (reconnecting / non-terminal disconnected) must NOT tear the editor
  // tree down — the runtime preserves the snapshot and re-authenticates
  // in the background. Unmounting RoomAuthenticatedView during a blip
  // would lose local UI state (selections, scroll, panel layout) for
  // every user every time their network flinches.
  const [hasEverAuthenticated, setHasEverAuthenticated] = useState(false);

  // The stripped-image handoff (window.__PLANNOTATOR_STRIPPED_IMAGES__)
  // is consumed in App.tsx now — App renders the banner directly
  // beneath the editor header so it reads as a normal notice rather
  // than a stacked card next to the floating RoomPanel that used to
  // live here. AppRoot writes the global; App reads it once at mount.

  // If we came in on a participant-only URL but sessionStorage holds an
  // admin secret for this roomId (previous create in this tab), recover
  // admin capability silently. This is the refresh path for creators.
  // Also treat storage-held admin as an "originatedLocally" signal: the
  // only way to get a sessionStorage entry for this roomId in this tab is
  // to have run the creator flow here. Used to pick the delete-success
  // fallback screen (creator returns to local mode; cold participant gets
  // the terminal screen).
  const storedAdminSecret = useMemo(
    () => loadAdminSecret(roomId),
    [roomId],
  );
  const effectiveOriginatedLocally = originatedLocally || storedAdminSecret !== null;

  const session = useCollabRoomSession({
    intent: 'join',
    url,
    user: identity ?? { id: 'anonymous', name: 'anon', color: '#888' },
    enabled: identity !== null,
    adminSecretOverride: storedAdminSecret ?? undefined,
  });

  // Latch hasEverAuthenticated on the first `authenticated` transition so
  // subsequent reconnects don't unmount the editor.
  React.useEffect(() => {
    if (session.room?.connectionStatus === 'authenticated') {
      setHasEverAuthenticated(true);
    }
  }, [session.room?.connectionStatus]);

  const handleJoin = useCallback((submit: { displayName: string; color: string }) => {
    // Persist gate edits back to room-origin ConfigStore so the same
    // identity + color prefills on the next room the user joins from
    // this browser. Same semantics as the StartRoomModal save-back in
    // App.tsx: identity is a Plannotator-wide preference, not a
    // per-visit input. Writes are no-ops when the submitted values
    // already match.
    if (submit.displayName && submit.displayName !== getIdentity()) {
      setCustomIdentity(submit.displayName);
    }
    if (submit.color && submit.color !== getPresenceColor()) {
      setPresenceColor(submit.color);
    }
    // Mark this room as "identity confirmed in this tab" so a reload
    // goes straight back in without re-prompting. Per-room scope means
    // opening a different room URL in this tab still surfaces the
    // (prefilled) gate so users can adjust per room.
    markRoomIdentityConfirmed(roomId);
    setIdentity({
      id: generateParticipantId(),
      name: submit.displayName,
      color: submit.color,
    });
  }, [roomId]);

  // Session-level error (e.g. URL parse failure in useCollabRoomSession).
  // Without this branch, a bad URL would leave the participant stuck in
  // JoinRoomGate with `connectionStatus: disconnected` forever since
  // `session.room` stays undefined.
  if (session.phase === 'error') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm">
          <h2 className="text-lg font-semibold">This link looks broken</h2>
          <p className="text-sm text-muted-foreground">
            {session.error?.message ?? 'The room URL could not be parsed.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Ask the person who shared this link to send it again.
          </p>
        </div>
      </div>
    );
  }

  // Terminal state: room deleted or expired.
  const roomStatus = session.room?.roomStatus ?? null;
  if (roomStatus === 'deleted' || roomStatus === 'expired') {
    if (effectiveOriginatedLocally) {
      // Creator/admin: show a concise banner. Falling back to local
      // mode with current editor state preserved would require
      // lifting editor state into RoomApp; we ship the terminal
      // banner and an unmount, matching the participant path's shape.
      return (
        <div className="p-4 text-sm text-muted-foreground">
          This live session has ended.
        </div>
      );
    }
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm">
          <h2 className="text-lg font-semibold">This room is no longer available</h2>
          <p className="text-sm text-muted-foreground">
            The live session has ended or been deleted.
          </p>
          <p className="text-xs text-muted-foreground">
            If you need to continue, ask the room creator for a new link.
          </p>
        </div>
      </div>
    );
  }

  // Pre-connect identity gate. Prefill from Plannotator preferences so
  // a returning user sees their saved name/color instead of blank inputs
  // (first-time visitors to room.plannotator.ai still get a generated
  // tater + hash-derived swatch, which is a reasonable default).
  if (identity === null) {
    return (
      <JoinRoomGate
        initialDisplayName={getIdentity()}
        initialColor={getPresenceColor()}
        connectionStatus="disconnected"
        onJoin={handleJoin}
      />
    );
  }

  // Terminal connect/auth failures: auth rejected, connect timeout,
  // room unavailable. These set connectionStatus='disconnected' with a
  // non-null lastError whose scope='join'. Show a terminal screen
  // matching the room-deleted/expired pattern. This branch fires even
  // if we previously authenticated — e.g. an admin-rejected reconnect.
  const connectionStatus = session.room?.connectionStatus ?? 'connecting';
  const joinError = session.room?.lastError;
  if (connectionStatus === 'disconnected' && joinError && joinError.scope === 'join') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm">
          <h2 className="text-lg font-semibold">
            {joinError.code === 'auth_rejected' ? 'Access denied' :
             joinError.code === 'connect_timeout' ? 'Connection timed out' :
             joinError.code === 'room_unavailable' ? 'Room unavailable' :
             'Could not join room'}
          </h2>
          <p className="text-sm text-muted-foreground">{joinError.message}</p>
          <p className="text-xs text-muted-foreground">
            Ask the person who shared this link to verify it.
          </p>
        </div>
      </div>
    );
  }

  // Pre-first-auth: keep the gate up with a status indicator. Once we've
  // ever authenticated, non-terminal transients (reconnecting, the brief
  // pre-terminal `disconnected` window before the auth-failure branch
  // above fires) keep RoomAuthenticatedView mounted — the status banner
  // inside it (RoomStatusBadge + reconnect banner) communicates the
  // transient state without tearing down editor/panel state.
  if (!hasEverAuthenticated && connectionStatus !== 'authenticated') {
    return (
      <JoinRoomGate
        initialDisplayName={identity.name}
        initialColor={identity.color}
        connectionStatus={connectionStatus}
        onJoin={handleJoin}
      />
    );
  }

  // Authenticated (or briefly transient after first auth): render editor
  // + room overlays. session.room can be undefined for a microtask if
  // useCollabRoomSession is mid-recomputation even after authentication;
  // fall back to the gate only in that pathological case.
  const room = session.room;
  if (!room) {
    return (
      <JoinRoomGate
        initialDisplayName={identity.name}
        initialColor={identity.color}
        connectionStatus={connectionStatus}
        onJoin={handleJoin}
      />
    );
  }
  return (
    <RoomAuthenticatedView
      room={room}
      session={session}
      identity={identity}
      renderEditor={renderEditor}
    />
  );
}

/**
 * Split from RoomApp so the cursor-presence hooks (pointer listeners,
 * presence throttle) are only mounted AFTER we've authenticated. Mounting
 * them in RoomApp's top-level would send presence through an un-ready
 * client during the identity-gate / connecting window.
 */
function RoomAuthenticatedView({
  room,
  session,
  identity,
  renderEditor,
}: {
  room: NonNullable<ReturnType<typeof useCollabRoomSession>['room']>;
  session: ReturnType<typeof useCollabRoomSession>;
  identity: CollabRoomUser;
  renderEditor: RoomAppProps['renderEditor'];
}): React.ReactElement {
  // Ref on the relative container so RemoteCursorLayer's coordinate
  // translation reads the overlay's actual viewport position. Measuring
  // `document.documentElement` would zero out the top/left and leave
  // cursors offset whenever the room shell is not flush against the
  // viewport edges (e.g. future layouts with a header/padding).
  const roomContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative" data-testid="room-app" ref={roomContainerRef}>
      {renderEditor({ roomSession: session })}

      {/*
        Null-rendering sibling that owns the pointermove listener and
        throttled presence send. See the component comment for why this
        is isolated from the editor tree.
      */}
      <LocalPresenceEmitter
        identity={identity}
        sendPresence={room.updatePresence}
      />

      <RemoteCursorLayerWithViewport
        remotePresence={room.remotePresence}
        containerRef={roomContainerRef}
      />
    </div>
  );
}

/**
 * Thin wrapper that tracks the overlay container rect for
 * `RemoteCursorLayer`. The passed `containerRef` points at the
 * `RemoteCursorLayer`'s nearest positioned ancestor — the layer itself
 * is `absolute inset-0`, so cursor coords need to be translated by
 * that ancestor's viewport offset. Scroll listeners are rAF-throttled
 * and `ResizeObserver` is used when available for container resizes
 * that don't fire a `window` resize (layout shifts, font loads).
 */
function RemoteCursorLayerWithViewport({
  remotePresence,
  containerRef,
}: {
  remotePresence: Record<string, import('@plannotator/shared/collab').PresenceState>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}): React.ReactElement {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId: number | null = null;
    const update = () => {
      rafId = null;
      setRect(el.getBoundingClientRect());
    };
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(update);
    };

    update();
    // Capture-phase scroll catches any scrolling ancestor, not just window.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(el);
    }

    return () => {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      // Cancel a pending frame so `setRect` can't fire after unmount.
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerRef]);

  return (
    <RemoteCursorLayer
      remotePresence={remotePresence}
      containerRect={rect}
    />
  );
}

/**
 * Null-rendering sibling of the editor that owns the pointermove
 * listener and the throttled `room.updatePresence` send.
 *
 * Why a dedicated component:
 *   `usePresenceThrottle` is effect-driven — it needs React state as
 *   its input to fire, so the value can't be pure-ref'd. If that
 *   state lived on `RoomApp` (as it originally did) every pointer
 *   move would rerender `RoomApp` and `RoomAuthenticatedView`,
 *   rebuild the inline `<App roomSession={...}/>` element produced
 *   by `renderEditor`, and — because `App` isn't `React.memo`'d —
 *   reconcile the entire editor subtree. On a long plan this is
 *   measurable jank at ~20Hz.
 *
 *   Keeping the state inside a component with no children and a
 *   `null` render confines the reconciliation cost to this component
 *   itself. The editor tree upstairs never observes pointermoves.
 *
 * Coordinate model — STICKY BLOCK ANCHOR:
 *   A document reflows. Pixel y-values in a scrolling document are
 *   NOT shared truth: two participants with different window widths
 *   can have the same content-y land on different paragraphs. So we
 *   anchor cursor position to `[data-block-id]` elements (paragraph,
 *   heading, list item, etc.) — each participant resolves the same
 *   block by id in their own DOM, and (x, y) relative to that block
 *   is the same semantic content location for both.
 *
 *   The prior non-sticky block attempt snapped at every block
 *   boundary because the anchor flipped between blocks as the
 *   pointer crossed whitespace. Sticky fixes that:
 *
 *     1. If the pointer is over a `[data-block-id]`, anchor = that
 *        block, emit (x, y) relative to its rect. Normal case.
 *     2. If the pointer is over whitespace / between blocks / over
 *        a non-block element inside the scroll viewport, KEEP the
 *        last anchor and emit coordinates relative to it — even if
 *        (x, y) falls outside the block's rect (negative y if above,
 *        y > block.height if below). Remote cursor smoothly traces
 *        the whitespace without a coordinate-space flip.
 *     3. Anchor switches only when the pointer actually lands on a
 *        different block. The emitted position at that switch jumps
 *        by the gap between consecutive blocks (~line-height), which
 *        the receiver's lerp smooths over.
 *
 *   When the pointer is OUTSIDE the scroll container (header, room
 *   menu, margins), we skip the emit entirely — the last anchored
 *   position stays on the wire so "Alice paused over paragraph 5 to
 *   use the room menu" shows her cursor frozen over paragraph 5
 *   rather than teleporting.
 *
 *   Emit `cursor: null` only on genuine leave (`window.blur` /
 *   `document.hidden`); that also resets the sticky anchor so the
 *   next session picks a fresh one.
 *
 * Scroll viewport lookup: App (rendered inside this component's
 * tree via `renderEditor`) tags the OverlayScrollbars viewport
 * element with `data-plan-scroll-viewport`. We `querySelector` for
 * it here. Implicit coupling flagged in App's `useOverlayViewport`
 * effect.
 *
 * Send cadence: 33ms trailing throttle (~30Hz), matching
 * Excalidraw-style collab tooling.
 */
function LocalPresenceEmitter({
  identity,
  sendPresence,
}: {
  identity: CollabRoomUser;
  sendPresence: (p: PresenceState) => Promise<void>;
}): null {
  const [localCursor, setLocalCursor] = useState<CursorState | null>(null);
  // Sticky block anchor. Lives in a ref so the pointermove handler
  // can read/write it synchronously without forcing re-renders.
  const lastAnchorBlockIdRef = useRef<string | null>(null);

  useEffect(() => {
    function findScrollViewport(): HTMLElement | null {
      return typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>('[data-plan-scroll-viewport]')
        : null;
    }

    function findBlockUnder(target: Element | null): HTMLElement | null {
      return (target?.closest?.('[data-block-id]') as HTMLElement | null) ?? null;
    }

    function findBlockById(id: string, within: ParentNode): HTMLElement | null {
      try {
        const escaped =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(id)
            : id.replace(/["\\]/g, '\\$&');
        return within.querySelector<HTMLElement>(`[data-block-id="${escaped}"]`);
      } catch {
        return null;
      }
    }

    function onPointerMove(e: PointerEvent) {
      const vp = findScrollViewport();
      if (!vp) return;  // App hasn't mounted its scroll area yet.
      const rect = vp.getBoundingClientRect();
      // Skip emits when the pointer is outside the scroll container —
      // keeps the remote cursor anchored to its last in-content spot
      // instead of flashing to the header or off-screen chrome.
      if (
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom
      ) {
        return;
      }

      // Sticky anchor resolution: prefer the block directly under the
      // pointer; fall back to the last-used anchor when the pointer
      // is over whitespace or a non-block element. The emitted (x, y)
      // may overflow the block's rect — the receiver just adds it to
      // their block's rect, producing a continuous trail through the
      // gap instead of a jump.
      let anchor = findBlockUnder(e.target as Element | null);
      if (!anchor && lastAnchorBlockIdRef.current) {
        anchor = findBlockById(lastAnchorBlockIdRef.current, vp);
      }
      if (!anchor) {
        // No block anywhere (e.g. empty plan, or first pointer move
        // happened over whitespace before any block was visited).
        // Skip until we pick up a real anchor.
        return;
      }

      const blockId = anchor.getAttribute('data-block-id');
      if (!blockId) return;
      lastAnchorBlockIdRef.current = blockId;

      const anchorRect = anchor.getBoundingClientRect();
      setLocalCursor({
        blockId,
        x: e.clientX - anchorRect.left,
        y: e.clientY - anchorRect.top,
        coordinateSpace: 'block',
      });
    }

    function clearCursor() {
      setLocalCursor(null);
      // Reset the sticky anchor so a fresh session picks a new one
      // rather than re-using a stale block id from a prior session.
      lastAnchorBlockIdRef.current = null;
    }
    function handleVisibilityChange() {
      if (document.hidden) clearCursor();
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('blur', clearCursor);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('blur', clearCursor);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Always a PresenceState (never null) so "pointer left content" can
  // be transmitted as `cursor: null`. `usePresenceThrottle(null, ...)`
  // would just cancel the pending send, leaving peers stuck with our
  // last position until the presence TTL sweep.
  const presenceState: PresenceState = useMemo(
    () => ({
      user: { id: identity.id, name: identity.name, color: identity.color },
      cursor: localCursor,
    }),
    [identity.id, identity.name, identity.color, localCursor],
  );

  usePresenceThrottle(presenceState, sendPresence, 33);

  return null;
}
