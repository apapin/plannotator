/**
 * useAnnotationController — returns an AnnotationController bound to either
 * local state (useState<Annotation[]>) or a CollabRoom session.
 *
 * This hook is the single mode-awareness point in App.tsx. Before Slice 5
 * every annotation mutation site called `setAnnotations(prev => ...)`
 * directly; now those call sites invoke `controller.add/update/remove/clear`,
 * which do the right thing for whichever mode is active.
 *
 * Room mode delegates to `useCollabRoom` with KIND-SPECIFIC pending
 * reconciliation:
 *
 *   add    — pending clears ONLY when the id appears in
 *            `room.annotations`. An unrelated peer's op advancing seq
 *            must NOT clear an add pending, because the optimistic
 *            row (exposed via `pendingAdditions`) would otherwise
 *            linger as an ordinary-looking panel row with no
 *            "Sending…" chrome and no Retry affordance. We need a real
 *            echo-by-id, a transport-promise rejection (→ `failed`),
 *            or explicit Discard to progress the row.
 *
 *   update — pending clears once `room.seq > sentAtSeq`. Concurrent-
 *            write supersession is acceptable: the canonical list
 *            shows the winning value, which is correct server state.
 *            Gating on patch-match would leave pending stuck forever
 *            when another user's write wins.
 *
 *   remove — pending clears once `room.seq > sentAtSeq`. Remove has no
 *            optimistic row to strand, so a spurious clear is harmless
 *            even for remove-of-already-absent (server no-op).
 *
 * Optimistic adds live in `pendingAdditions` (panel-only; NOT merged
 * into the canonical `annotations` list). This preserves the V1
 * server-authoritative contract — approve/deny/export never see
 * un-echoed rows.
 *
 * `failed` entries carry kind + payload so retry() can re-send without
 * the caller providing the op args again. Slice 5 is online-only:
 * failed ops surface Retry/Discard UI; they do NOT auto-replay on
 * reconnect.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnnotationController,
  PendingKind,
  PendingOp,
  FailedOp,
} from '../types/annotationController';
import type { Annotation } from '../types';
import type { UseCollabRoomReturn } from './useCollabRoom';
import type { RoomAnnotation } from '@plannotator/shared/collab';
import { toRoomAnnotation as sharedToRoomAnnotation } from '@plannotator/shared/collab';

const EMPTY_PENDING_PUBLIC: ReadonlyMap<string, PendingOp> = new Map();
const EMPTY_FAILED: ReadonlyMap<string, FailedOp> = new Map();
const EMPTY_PENDING_ADDITIONS: ReadonlyMap<string, Annotation> = new Map();

export function useLocalAnnotationController(
  initial: Annotation[] = [],
): AnnotationController {
  const [annotations, setAnnotations] = useState<Annotation[]>(initial);

  const add = useCallback((ann: Annotation) => {
    setAnnotations(prev => [...prev, ann]);
  }, []);

  const update = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotations(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const remove = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  }, []);

  const clear = useCallback((source?: string) => {
    if (source === undefined) {
      setAnnotations([]);
    } else {
      setAnnotations(prev => prev.filter(a => a.source !== source));
    }
  }, []);

  return {
    mode: 'local',
    annotations,
    pendingAdditions: EMPTY_PENDING_ADDITIONS,
    pending: EMPTY_PENDING_PUBLIC,
    failed: EMPTY_FAILED,
    add,
    update,
    remove,
    clear,
    setAll: setAnnotations,
  };
}

/** Payload retained per-failed-op so retry() can reconstruct the send. */
type RetryPayload =
  | { kind: 'add'; value: RoomAnnotation }
  | { kind: 'update'; value: { id: string; patch: Partial<RoomAnnotation> } }
  | { kind: 'remove'; value: { id: string } };

/**
 * Room-mode pending entry. `sentAtSeq` is the server seq at send time,
 * consulted by the kind-specific reconciliation effect below:
 *
 *   add    — NOT cleared by seq advance. Only cleared when the echoed
 *            annotation appears in `room.annotations` (id match), or
 *            by the server-rejection / transport-rejection paths.
 *            Clearing on unrelated seq advance would leave the
 *            optimistic row in `pendingAdditions` stranded as an
 *            ordinary-looking panel row with no "Sending…" chrome.
 *   update — cleared once `room.seq > sentAtSeq`. Concurrent-write
 *            supersession is acceptable; the canonical list already
 *            shows the winning value.
 *   remove — cleared once `room.seq > sentAtSeq`. Has no optimistic row
 *            to strand, so a spurious clear on remove-of-absent is
 *            harmless.
 *
 * `expectedPatch` is snapshotted for update ops and consumed by retry()
 * to rebuild the retry payload; the reconcile effect doesn't consult it.
 */
interface RoomPending extends PendingOp {
  /** Server seq at the moment this op was sent. */
  sentAtSeq: number;
  /** For 'update' only — retained for retry()'s payload reconstruction. */
  expectedPatch?: Partial<RoomAnnotation>;
}

export function useRoomAnnotationController(
  room: UseCollabRoomReturn,
): AnnotationController {
  const [pending, setPending] = useState<ReadonlyMap<string, RoomPending>>(
    () => new Map<string, RoomPending>(),
  );
  const [failed, setFailed] = useState<ReadonlyMap<string, FailedOp>>(EMPTY_FAILED);
  /**
   * Optimistic-add buffer surfaced via the `pendingAdditions` field —
   * PANEL-ONLY. These entries are NOT merged into the canonical
   * `annotations` list, so the Viewer (which renders off the canonical
   * list) never sees them; only the annotation sidebar does, where it
   * attaches "Sending…" / failed chrome around the row. Keeping them
   * out of the canonical list preserves the V1 server-authoritative
   * contract for approve/deny/export.
   *
   * Entries are removed:
   *   - when the server echoes the id (it appears in room.annotations), OR
   *   - on explicit Discard (failed row dismissed by the user).
   *
   * Failed adds keep their buffer entry so the sidebar still has a row
   * on which to render the Retry/Discard affordances.
   */
  const [optimisticAdds, setOptimisticAdds] = useState<ReadonlyMap<string, Annotation>>(
    () => new Map<string, Annotation>(),
  );
  // Buffer failed-op payloads keyed by id so retry() can re-send without
  // requiring the caller to pass the annotation back in.
  const failedPayloadsRef = useRef<Map<string, RetryPayload>>(new Map());

  // Project room.annotations to a by-id Map. The reconcile effect below
  // consults it for the 'add' kind (clear when id echoes), and takes it
  // as a dep so any `room.annotations` update re-runs the reconciliation
  // for update/remove seq-advance checks.
  const echoedById = useMemo(() => {
    const m = new Map<string, RoomAnnotation>();
    for (const a of room.annotations) m.set(a.id, a);
    return m;
  }, [room.annotations]);

  // Server-rejection reconciliation for MUTATION errors.
  //
  // V1 has no opId-correlated reject: a rejected mutation produces a
  // `room.error` on the client, with no seq advance and no per-op
  // correlation. Without an explicit clear path, a rejection (e.g.
  // lock-during-submit at apps/room-service/core/room-do.ts:377) would
  // leave `add` pending forever (never echoed) and `update`/`remove`
  // pending until some unrelated op bumped seq.
  //
  // Three correctness invariants enforced here:
  //
  //   1. Dedupe by `lastErrorId`, not object identity. CollabRoomClient
  //      clones `lastError` on every state emit, so a stale error re-
  //      emerges as a fresh object. Reacting to that would falsely mark
  //      later successful sends as failed.
  //
  //   2. Filter by `scope === 'mutation'`. The client now classifies
  //      errors into narrow scopes: only server-sent rejections of a
  //      mutation this client sent use 'mutation'. Admin rejections,
  //      peer inbound-event decode failures, presence decode failures,
  //      snapshot decode failures, and join-phase failures all share
  //      the `lastError` field but MUST NOT transition our pending ops.
  //      Without this filter, a peer's malformed presence frame could
  //      spuriously move our valid in-flight annotation add to failed.
  //
  //   3. Best-effort correlation within those constraints: on a new
  //      mutation-scoped error, mark every currently-pending op as
  //      failed. V1 has no opId-level correlation, so if two sends
  //      raced and the server only rejected one, both get marked failed
  //      and the user will Retry one unnecessarily — accepted tradeoff
  //      over a silent stuck shimmer.
  const lastErrorIdRef = useRef<number>(0);
  useEffect(() => {
    const id = room.lastErrorId;
    if (id === lastErrorIdRef.current) return;
    lastErrorIdRef.current = id;

    const err = room.lastError;
    if (!err || err.scope !== 'mutation') return;
    if (pending.size === 0) return;

    // Snapshot current pending → failed with the server's error message.
    setPending(prev => (prev.size === 0 ? prev : new Map()));
    setFailed(prev => {
      const next = new Map(prev);
      for (const [pid, op] of pending) {
        next.set(pid, { id: pid, kind: op.kind, error: `${err.code}: ${err.message}` });
        // Reconstruct a retry payload if we still have enough context.
        // For 'add' we need the original RoomAnnotation — it lives in
        // optimisticAdds. For update/remove the op carried its patch/id.
        if (op.kind === 'add') {
          const stashed = optimisticAdds.get(pid);
          if (stashed) {
            failedPayloadsRef.current.set(pid, {
              kind: 'add',
              value: toRoomAnnotation(stashed),
            });
          }
        } else if (op.kind === 'update' && op.expectedPatch) {
          failedPayloadsRef.current.set(pid, {
            kind: 'update',
            value: { id: pid, patch: op.expectedPatch },
          });
        } else if (op.kind === 'remove') {
          failedPayloadsRef.current.set(pid, {
            kind: 'remove',
            value: { id: pid },
          });
        }
      }
      return next;
    });
  }, [room.lastErrorId, room.lastError, pending, optimisticAdds]);

  // Reconciliation is KIND-SPECIFIC to avoid a leaky pending state when
  // an unrelated op advances seq before our send echoes:
  //
  //   add     — clear only when the id appears in room.annotations. An
  //             unrelated seq advance must NOT clear an add, because the
  //             optimistic row (pendingAdditions) is still visible and we
  //             need either a real echo or an explicit
  //             reject-via-promise/Retry/Discard to progress it. Without
  //             this, a concurrent peer's op could bump seq while our add
  //             is in flight, the pending entry would drop, and the
  //             optimistic row would linger as an ordinary-looking panel
  //             row (no Sending… chrome, no Retry affordance) until the
  //             eventual echo or manual dismissal.
  //   update  — clear on seq advance past sentAtSeq. Concurrent-write
  //             supersession is acceptable; the canonical annotation list
  //             already shows the winning value.
  //   remove  — same seq-based clear. Remove has no optimistic row to
  //             strand, so a spurious clear is harmless.
  useEffect(() => {
    if (pending.size === 0) return;
    let changed = false;
    const next = new Map(pending);
    for (const [id, op] of pending) {
      if (op.kind === 'add') {
        if (echoedById.has(id)) {
          next.delete(id);
          changed = true;
        }
        continue;
      }
      // KNOWN V1 EDGE CASE: if an unrelated peer op bumps seq past our
      // sentAtSeq before the server processes our mutation, this clears
      // the pending entry. If the server then REJECTS our mutation (via
      // room.error), the error-driven path (below) finds nothing in
      // `pending` to mark as failed. The user never sees the failure.
      //
      // This race requires: (a) we send an update/remove, (b) a peer's
      // op is admitted and echoed before our op, (c) the server then
      // rejects ours. Window is narrow (sub-RTT). Proper fix requires
      // opId-correlated reject from the server (V2 protocol work).
      // Accepted for Slice 5 over stuck-shimmer on every concurrent-
      // edit scenario.
      if (room.seq > op.sentAtSeq) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) setPending(next);
  }, [echoedById, pending, room.seq]);

  const markPending = useCallback((op: RoomPending) => {
    setPending(prev => {
      const next = new Map(prev);
      next.set(op.id, op);
      return next;
    });
  }, []);

  const markFailed = useCallback((
    id: string,
    kind: PendingKind,
    payload: RetryPayload,
    err: unknown,
  ) => {
    setPending(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    const message = err instanceof Error ? err.message : String(err);
    setFailed(prev => {
      const next = new Map(prev);
      next.set(id, { id, kind, error: message });
      return next;
    });
    failedPayloadsRef.current.set(id, payload);
  }, []);

  const clearFailedFor = useCallback((id: string) => {
    failedPayloadsRef.current.delete(id);
    setFailed(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const addOptimistic = useCallback((ann: Annotation) => {
    setOptimisticAdds(prev => {
      const next = new Map(prev);
      next.set(ann.id, ann);
      return next;
    });
  }, []);

  const clearOptimisticAdd = useCallback((id: string) => {
    setOptimisticAdds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const add = useCallback((ann: Annotation) => {
    const roomAnn = toRoomAnnotation(ann);
    addOptimistic(ann);
    markPending({ id: ann.id, kind: 'add', sentAtSeq: room.seq });
    void room.addAnnotations([roomAnn]).catch(err => {
      markFailed(ann.id, 'add', { kind: 'add', value: roomAnn }, err);
    });
  }, [room, addOptimistic, markPending, markFailed]);

  const update = useCallback((id: string, patch: Partial<Annotation>) => {
    const roomPatch = toRoomAnnotationPatch(patch);
    markPending({ id, kind: 'update', sentAtSeq: room.seq, expectedPatch: roomPatch });
    void room.updateAnnotation(id, roomPatch).catch(err => {
      markFailed(id, 'update', { kind: 'update', value: { id, patch: roomPatch } }, err);
    });
  }, [room, markPending, markFailed]);

  const remove = useCallback((id: string) => {
    markPending({ id, kind: 'remove', sentAtSeq: room.seq });
    void room.removeAnnotations([id]).catch(err => {
      markFailed(id, 'remove', { kind: 'remove', value: { id } }, err);
    });
  }, [room, markPending, markFailed]);

  const clear = useCallback((source?: string) => {
    void room.clearAnnotations(source).catch(() => {
      // clear has no single-id identity — failure surfaces via room.lastError
      // and the UI disables further writes while disconnected.
    });
  }, [room]);

  const retry = useCallback((id: string) => {
    const p = failedPayloadsRef.current.get(id);
    if (!p) return;
    clearFailedFor(id);
    switch (p.kind) {
      case 'add':
        markPending({ id, kind: 'add', sentAtSeq: room.seq });
        void room.addAnnotations([p.value]).catch(err => {
          markFailed(id, 'add', p, err);
        });
        break;
      case 'update':
        markPending({ id, kind: 'update', sentAtSeq: room.seq, expectedPatch: p.value.patch });
        void room.updateAnnotation(p.value.id, p.value.patch).catch(err => {
          markFailed(id, 'update', p, err);
        });
        break;
      case 'remove':
        markPending({ id, kind: 'remove', sentAtSeq: room.seq });
        void room.removeAnnotations([p.value.id]).catch(err => {
          markFailed(id, 'remove', p, err);
        });
        break;
    }
  }, [room, clearFailedFor, markPending, markFailed]);

  const discard = useCallback((id: string) => {
    clearFailedFor(id);
    clearOptimisticAdd(id);  // failed-add row goes away on Discard
  }, [clearFailedFor, clearOptimisticAdd]);

  // Drop optimistic entries for ids that have arrived via echo. We run
  // this as an effect so the UI doesn't double-render a row from both the
  // buffer and room.annotations.
  useEffect(() => {
    if (optimisticAdds.size === 0) return;
    let changed = false;
    const next = new Map(optimisticAdds);
    for (const a of room.annotations) {
      if (next.delete(a.id)) changed = true;
    }
    if (changed) setOptimisticAdds(next);
  }, [optimisticAdds, room.annotations]);

  // `annotations` is strictly the server-echoed state — V1 is
  // server-authoritative, so pending/failed adds must NOT appear here.
  // Rendering them in the panel is the UI's job via `pendingAdditions`.
  const annotations = useMemo<Annotation[]>(
    () => room.annotations.map(toEditorAnnotation),
    [room.annotations],
  );

  // Expose optimistic adds separately so the annotation panel can draw
  // "Sending…"/failed rows without contaminating the canonical list.
  const pendingAdditions = optimisticAdds;

  const isLocked = room.roomStatus === 'locked';

  return {
    mode: 'room',
    annotations,
    pendingAdditions,
    pending,
    failed,
    add,
    update,
    remove,
    clear,
    retry,
    discard,
    isLocked,
  };
}

/** Public selector. Pass `room` to enter room mode, otherwise returns local. */
export function useAnnotationController(options: {
  initial?: Annotation[];
  room?: UseCollabRoomReturn;
}): AnnotationController {
  // Hooks must be called unconditionally in the same order per render, so
  // both impls run. We only consume the relevant one based on `room`.
  // This costs one extra useState in the unused branch — acceptable for the
  // simpler call-site contract.
  const local = useLocalAnnotationController(options.initial);
  const roomController = useRoomAnnotationControllerOptional(options.room);
  return options.room ? roomController : local;
}

function useRoomAnnotationControllerOptional(
  room: UseCollabRoomReturn | undefined,
): AnnotationController {
  // Always call the hook; pass a dummy placeholder when room is undefined
  // so we don't violate the rules-of-hooks. The returned controller is
  // discarded unless the caller passed a real room.
  const placeholder = usePlaceholderRoom();
  return useRoomAnnotationController(room ?? placeholder);
}

function usePlaceholderRoom(): UseCollabRoomReturn {
  return useMemo<UseCollabRoomReturn>(() => ({
    connectionStatus: 'disconnected',
    roomStatus: null,
    planMarkdown: '',
    annotations: [],
    seq: 0,
    remotePresence: {},
    hasAdminCapability: false,
    lastError: null,
    lastErrorId: 0,
    addAnnotations: async () => {},
    updateAnnotation: async () => {},
    removeAnnotations: async () => {},
    clearAnnotations: async () => {},
    updatePresence: async () => {},
    lock: async () => {},
    unlock: async () => {},
    deleteRoom: async () => {},
    client: null,
  }), []);
}

/** Narrow the shared helper's generic return to Annotation-compatible shape. */
function toRoomAnnotation(a: Annotation): RoomAnnotation {
  return sharedToRoomAnnotation(a) as RoomAnnotation;
}

function toRoomAnnotationPatch(p: Partial<Annotation>): Partial<RoomAnnotation> {
  return sharedToRoomAnnotation(p) as Partial<RoomAnnotation>;
}

function toEditorAnnotation(a: RoomAnnotation): Annotation {
  // RoomAnnotation has no images; Annotation's images is optional, so the
  // shape is already compatible without images.
  return a as Annotation;
}
