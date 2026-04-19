/**
 * AnnotationController — uniform mutation surface for the editor across
 * local-only and live-room modes.
 *
 * App.tsx calls `controller.add/update/remove/clear` without caring whether
 * state is owned by `useState` (local mode) or by `useCollabRoom` (room mode).
 * Previously every mutation site in App.tsx called `setAnnotations(prev => ...)`
 * directly; that pattern does not compose with the server-authoritative
 * write model of live rooms.
 *
 * Two fields are implementation-specific and optional:
 *   - `setAll` — local mode only. Exposed for `useSharing` (shared-URL
 *     import) and draft-restore paths that need to REPLACE the entire list
 *     atomically. Room mode cannot express "replace all" as a single
 *     protocol op; callers must branch on `controller.setAll`.
 *   - `isLocked` — room mode only. Surfaced so the UI can disable mutation
 *     affordances when the admin has locked the room.
 *
 * `pending` holds operations that have been sent but whose echo hasn't
 * arrived yet. Keyed by id with the op kind attached. The room-mode
 * reconciliation is kind-specific:
 *   - add:    clears only when the id appears in room.annotations;
 *             unrelated seq advances must NOT clear, or the optimistic
 *             row in `pendingAdditions` would lose its "Sending…" chrome.
 *   - update: clears once room.seq > sentAtSeq (concurrent supersession
 *             is fine — canonical list shows the winning value).
 *   - remove: clears once room.seq > sentAtSeq (no optimistic row to
 *             strand; spurious clear on remove-of-absent is harmless).
 * See `useAnnotationController.ts` for the full rationale.
 *
 * `failed` holds entries whose last send attempt rejected. Each carries
 * kind + payload so the UI can offer per-op Retry/Discard without the
 * caller holding onto the original Annotation reference. Slice 5 is
 * online-only — failed ops do NOT auto-replay on reconnect.
 */

import type { Annotation } from '../types';

export type PendingKind = 'add' | 'update' | 'remove';

export interface PendingOp {
  id: string;
  kind: PendingKind;
}

export interface FailedOp {
  id: string;
  kind: PendingKind;
  /** Human-readable error summary suitable for a tooltip/toast. */
  error: string;
}

export interface AnnotationController {
  mode: 'local' | 'room';
  /**
   * Canonical annotation list. In room mode this is ONLY the
   * server-echoed state — pending adds do NOT appear here, so
   * consumers that feed approve/deny/export never include un-confirmed
   * ops (V1 contract: server-authoritative, no optimistic apply).
   */
  annotations: Annotation[];
  /**
   * Optimistic rows for sends that haven't been echoed yet. UI-only —
   * render these in the annotation panel for "Sending…" feedback, but
   * NEVER merge into approve/deny/export payloads. Always empty in
   * local mode.
   */
  pendingAdditions: ReadonlyMap<string, Annotation>;
  pending: ReadonlyMap<string, PendingOp>;
  failed: ReadonlyMap<string, FailedOp>;

  add(annotation: Annotation): void;
  update(id: string, patch: Partial<Annotation>): void;
  remove(id: string): void;
  clear(source?: string): void;

  /** Retry a previously-failed send. No-op in local mode. */
  retry?(id: string): void;
  /** Drop a failed pending record without retrying. No-op in local mode. */
  discard?(id: string): void;

  /** Local mode only. Atomic replace-all; undefined in room mode. */
  setAll?: React.Dispatch<React.SetStateAction<Annotation[]>>;
  /** Room mode only. Undefined in local mode. */
  isLocked?: boolean;
}
