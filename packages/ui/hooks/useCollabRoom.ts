/**
 * React hook wrapping CollabRoomClient for editor/component consumption.
 *
 * Usage:
 *   const room = useCollabRoom({ url, user, adminSecret? });
 *   room.addAnnotations([ann]);
 *
 * Effect deps: [url, adminSecret, user.id, enabled]. Change any and the hook
 * tears down the client and creates a new one. For stable connections, consumers
 * should memoize `user` (used by value) and avoid mutating `url`/`adminSecret`.
 *
 * Changes to user.name/color propagate via the next sendPresence() call without
 * reconnecting.
 *
 * === Key-gated client ===
 * The effect runs AFTER the render commits. So when url/adminSecret/user.id/
 * enabled change, React could otherwise return a render of the previous
 * authenticated state and old client before the effect fires. To prevent a
 * click in that window sending to the wrong room, every read (state +
 * requireClient) compares the CURRENT render's prop key against the key the
 * stored client was created for. Mismatch returns DISCONNECTED_STATE /
 * client: null / mutations throw unavailable-client.
 *
 * === Mutation contract (V1) ===
 * Mutation methods (`addAnnotations`, `updateAnnotation`, `removeAnnotations`,
 * `clearAnnotations`) resolve when the op is SENT to the server, not when
 * local state has been updated. The returned `annotations` array reflects
 * server-echoed state — awaiting `addAnnotations(...)` and then reading
 * `annotations` synchronously may still show pre-echo state.
 *
 * For reactive UI, render from the returned `annotations` field; it updates
 * via React state when the server echo arrives and is applied by the client.
 * This mirrors `CollabRoomClient`'s `state` event contract.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  joinRoom,
  InvalidRoomUrlError,
  InvalidAdminSecretError,
  ConnectTimeoutError,
  AuthRejectedError,
  RoomUnavailableError,
  type CollabRoomClient,
  type CollabRoomState,
  type CollabRoomUser,
  type ConnectionStatus,
} from '@plannotator/shared/collab/client';
import type {
  PresenceState,
  RoomAnnotation,
  RoomStatus,
} from '@plannotator/shared/collab';

export interface UseCollabRoomOptions {
  /** Full room URL including #key= fragment. */
  url: string;
  /** base64url admin secret if not carried in URL. Hook does NOT persist. */
  adminSecret?: string;
  /** User identity. Consumer should memoize for stable reconnect behavior. */
  user: CollabRoomUser;
  /** Default true. When false, no connection is established. */
  enabled?: boolean;
}

export interface UseCollabRoomReturn {
  connectionStatus: ConnectionStatus;
  roomStatus: RoomStatus | null;
  planMarkdown: string;
  annotations: RoomAnnotation[];
  remotePresence: Record<string, PresenceState>;
  hasAdminCapability: boolean;
  lastError: { code: string; message: string } | null;

  addAnnotations: (a: RoomAnnotation[]) => Promise<void>;
  updateAnnotation: (id: string, patch: Partial<RoomAnnotation>) => Promise<void>;
  removeAnnotations: (ids: string[]) => Promise<void>;
  clearAnnotations: (source?: string) => Promise<void>;
  updatePresence: (p: PresenceState) => Promise<void>;

  /**
   * Lock the room. Optionally include a final snapshot as the baseline for
   * future fresh joiners. For product UI use, prefer `includeFinalSnapshot: true`
   * — the client builds the snapshot and its atSeq atomically from current
   * internal state, so there is no caller race. Advanced callers can supply
   * `{ finalSnapshot, finalSnapshotSeq }` directly via the escape hatch client.
   */
  lock: (opts?: { includeFinalSnapshot?: boolean }) => Promise<void>;
  unlock: () => Promise<void>;
  deleteRoom: () => Promise<void>;

  /**
   * Escape hatch for advanced consumers. May be non-null before authentication
   * completes (e.g. during the `connecting` / `authenticating` window); gate
   * mutations on `connectionStatus === 'authenticated'` rather than on this
   * field being non-null.
   *
   * Additionally, the hook key-gates this reference — if the current render's
   * props (url/adminSecret/user.id/enabled) don't match the props the stored
   * client was created for, this returns null to prevent sending to a stale
   * room between render and the next effect run.
   */
  client: CollabRoomClient | null;
}

const DISCONNECTED_STATE: CollabRoomState = {
  connectionStatus: 'disconnected',
  roomStatus: null,
  roomId: '',
  clientId: '',
  seq: 0,
  planMarkdown: '',
  annotations: [],
  remotePresence: {},
  hasAdminCapability: false,
  lastError: null,
};

/**
 * Map joinRoom() / connect() errors to stable, UI-friendly codes so consumers
 * can render actionable messages without string-matching `err.message`.
 */
function mapJoinFailure(err: unknown): { code: string; message: string } {
  if (err instanceof InvalidRoomUrlError) return { code: 'invalid_room_url', message: err.message };
  if (err instanceof InvalidAdminSecretError) return { code: 'invalid_admin_secret', message: err.message };
  if (err instanceof ConnectTimeoutError) return { code: 'connect_timeout', message: err.message };
  if (err instanceof AuthRejectedError) return { code: 'auth_rejected', message: err.message };
  if (err instanceof RoomUnavailableError) return { code: 'room_unavailable', message: err.message };
  return { code: 'join_failed', message: err instanceof Error ? err.message : String(err) };
}

/**
 * Serializable identity of the current hook props for comparison.
 * JSON-array encoding avoids ambiguity around delimiters in url/user.id —
 * this key is the ONLY barrier preventing a stale-room send, so it must be
 * collision-proof regardless of what the caller passes.
 */
function roomKeyFor(url: string, adminSecret: string | undefined, userId: string, enabled: boolean): string {
  return JSON.stringify([enabled, userId, adminSecret ?? null, url]);
}

export function useCollabRoom(options: UseCollabRoomOptions): UseCollabRoomReturn {
  const { url, adminSecret, user, enabled = true } = options;
  const currentKey = roomKeyFor(url, adminSecret, user.id, enabled);

  const [state, setState] = useState<CollabRoomState>(DISCONNECTED_STATE);
  const [stateKey, setStateKey] = useState<string>('');  // key the state belongs to
  const clientRef = useRef<CollabRoomClient | null>(null);
  const clientKeyRef = useRef<string>('');  // key the stored client was created for

  // Keep user in a ref so mutation callbacks see latest name/color without
  // triggering a reconnect. Reconnect only fires when user.id changes.
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    // Reset synchronously on every dep change BEFORE any async setup. Between
    // render and the async setup completing, key-gated reads below see
    // DISCONNECTED_STATE / client: null for the new key so consumers can't
    // send to the previous room.
    clientRef.current = null;
    clientKeyRef.current = '';
    setState(DISCONNECTED_STATE);
    setStateKey(currentKey);

    if (!enabled) {
      return;
    }

    const effectKey = currentKey;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let createdClient: CollabRoomClient | null = null;

    (async () => {
      try {
        const client = await joinRoom({
          url,
          adminSecret,
          user: userRef.current,
          autoConnect: false,
        });
        createdClient = client;

        if (cancelled) {
          client.disconnect();
          return;
        }

        clientRef.current = client;
        clientKeyRef.current = effectKey;
        unsubscribe = client.on('state', (s) => {
          // React Strict Mode runs effects twice in dev: mount → cleanup → mount.
          // The outgoing cleanup sets `cancelled = true` but does not unsubscribe
          // listeners from the previous client synchronously before disconnect,
          // and disconnect() may emit a final 'closed' state event on this
          // listener's tick. Without this guard, that late emission would call
          // React setters on a cleaned-up effect and produce noisy state/flicker
          // (and is a teardown race under unmount-during-reconnect in prod too).
          if (cancelled) return;
          setState(s);
          setStateKey(effectKey);
        });

        // Push initial state
        setState(client.getState());
        setStateKey(effectKey);

        await client.connect();
      } catch (err) {
        // Unsubscribe BEFORE disconnecting so we don't receive a spurious
        // 'closed' state event during teardown between the failure and the
        // error surface below.
        unsubscribe?.();
        unsubscribe = null;
        if (createdClient) {
          try { createdClient.disconnect(); } catch { /* ignore */ }
          if (clientRef.current === createdClient) {
            clientRef.current = null;
            clientKeyRef.current = '';
          }
        }
        if (!cancelled) {
          setState({
            ...DISCONNECTED_STATE,
            lastError: mapJoinFailure(err),
          });
          setStateKey(effectKey);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      clientRef.current?.disconnect();
      clientRef.current = null;
      clientKeyRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, adminSecret, user.id, enabled]);

  const requireClient = useCallback((): CollabRoomClient => {
    const c = clientRef.current;
    if (!c || clientKeyRef.current !== currentKey) {
      throw new Error('Collab room client is not available (disabled, not yet connected, or room identity changed)');
    }
    return c;
  }, [currentKey]);

  const addAnnotations = useCallback(async (a: RoomAnnotation[]) => {
    await requireClient().sendAnnotationAdd(a);
  }, [requireClient]);
  const updateAnnotation = useCallback(async (id: string, patch: Partial<RoomAnnotation>) => {
    await requireClient().sendAnnotationUpdate(id, patch);
  }, [requireClient]);
  const removeAnnotations = useCallback(async (ids: string[]) => {
    await requireClient().sendAnnotationRemove(ids);
  }, [requireClient]);
  const clearAnnotations = useCallback(async (source?: string) => {
    await requireClient().sendAnnotationClear(source);
  }, [requireClient]);
  const updatePresence = useCallback(async (p: PresenceState) => {
    await requireClient().sendPresence(p);
  }, [requireClient]);
  const lock = useCallback(async (opts?: { includeFinalSnapshot?: boolean }) => {
    await requireClient().lockRoom(opts);
  }, [requireClient]);
  const unlock = useCallback(async () => {
    await requireClient().unlockRoom();
  }, [requireClient]);
  const deleteRoom = useCallback(async () => {
    await requireClient().deleteRoom();
  }, [requireClient]);

  // Key-gate the returned state. If the hook's props have changed this render
  // but the state was written against the previous key, return DISCONNECTED.
  // Also gate the client escape hatch against the same key.
  const stateForRender = stateKey === currentKey ? state : DISCONNECTED_STATE;
  const clientForRender = clientKeyRef.current === currentKey ? clientRef.current : null;

  return {
    connectionStatus: stateForRender.connectionStatus,
    roomStatus: stateForRender.roomStatus,
    planMarkdown: stateForRender.planMarkdown,
    annotations: stateForRender.annotations,
    remotePresence: stateForRender.remotePresence,
    hasAdminCapability: stateForRender.hasAdminCapability,
    lastError: stateForRender.lastError,
    addAnnotations,
    updateAnnotation,
    removeAnnotations,
    clearAnnotations,
    updatePresence,
    lock,
    unlock,
    deleteRoom,
    client: clientForRender,
  };
}
