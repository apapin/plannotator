/**
 * Pure reducer: applies a decrypted RoomServerEvent to a Map<id, RoomAnnotation>.
 *
 * In V1 this runs only on the server-echo path — the client does not apply
 * annotation ops optimistically. Server echo is authoritative; this reducer
 * is the single point where annotations enter state.
 *
 * Separated from the client class so it can be unit-tested without WebSocket mocks.
 */

import { isRoomAnnotation, type RoomAnnotation, type RoomServerEvent } from '../types';

/** Shallow + nested-meta clone so stored annotations are isolated from inputs.
 *  Exported so client.ts and other reducer callers share the same definition —
 *  avoids the drift risk of two helpers cloning the same nested fields. */
export function cloneRoomAnnotation(a: RoomAnnotation): RoomAnnotation {
  return {
    ...a,
    startMeta: a.startMeta ? { ...a.startMeta } : undefined,
    endMeta: a.endMeta ? { ...a.endMeta } : undefined,
  };
}

/**
 * Clone a partial patch, including nested startMeta/endMeta. A direct-event
 * subscriber mutating the emitted event.patch.startMeta must not reach back
 * into the stored annotation, and vice versa.
 */
export function cloneRoomAnnotationPatch(patch: Partial<RoomAnnotation>): Partial<RoomAnnotation> {
  const out: Partial<RoomAnnotation> = { ...patch };
  if (patch.startMeta !== undefined) out.startMeta = { ...patch.startMeta };
  if (patch.endMeta !== undefined) out.endMeta = { ...patch.endMeta };
  return out;
}

/**
 * Apply an annotation-related event to the annotations map.
 * Mutates the map in place. Returns a hint for the caller about what happened.
 *
 * Annotations from the event are CLONED before being stored. Callers (and
 * event subscribers) can safely mutate input annotations without reaching
 * back into the stored map.
 */
export function applyAnnotationEvent(
  annotations: Map<string, RoomAnnotation>,
  event: RoomServerEvent,
): { applied: boolean; reason?: string } {
  switch (event.type) {
    case 'annotation.add':
      for (const ann of event.annotations) {
        annotations.set(ann.id, cloneRoomAnnotation(ann));
      }
      return { applied: true };

    case 'annotation.update': {
      const existing = annotations.get(event.id);
      if (!existing) {
        return { applied: false, reason: `annotation ${event.id} not found` };
      }
      // `undefined` in a patch means "field absent / no change" — it is NOT
      // a clear-field signal. We strip own-property undefined values before
      // the spread so `{ text: undefined }` is treated identically to `{}`
      // and does not create an own `text` key on the stored annotation.
      //
      // Wire-path patches come from JSON (which cannot encode undefined), so
      // this only matters for direct in-process callers. If clear-field
      // semantics are ever needed, add them explicitly via `null` or a
      // dedicated operation; do not repurpose `undefined`.
      const normalized = Object.fromEntries(
        Object.entries(event.patch).filter(([, v]) => v !== undefined),
      ) as Partial<RoomAnnotation>;
      // Clone nested startMeta/endMeta before merging so a later mutation to
      // the input patch can't reach back into the stored annotation.
      const patch = cloneRoomAnnotationPatch(normalized);
      // Defense-in-depth: isRoomAnnotationPatch rejects `id` in patches, but
      // we also force `id` back to `existing.id` here. Without this, a patch
      // that slipped through with a mismatched `id` would store an annotation
      // under map key `existing.id` whose object reports a different id —
      // subsequent removes/updates by the visible id would miss it.
      const merged = { ...existing, ...patch, id: existing.id } as RoomAnnotation;
      // Validate the MERGED final annotation against the full annotation
      // validator. Individual patch fields pass their type checks but can
      // still produce an invalid final state when combined with existing
      // fields — e.g. a patch { blockId: '' } applied to a COMMENT, or a
      // patch { type: 'COMMENT' } applied to a GLOBAL_COMMENT that carried
      // blockId: ''. isRoomAnnotation enforces cross-field invariants
      // (inline annotations require non-empty blockId, etc.).
      if (!isRoomAnnotation(merged)) {
        return { applied: false, reason: `merged annotation ${event.id} failed shape validation` };
      }
      annotations.set(event.id, cloneRoomAnnotation(merged));
      return { applied: true };
    }

    case 'annotation.remove':
      for (const id of event.ids) {
        annotations.delete(id);
      }
      return { applied: true };

    case 'annotation.clear': {
      if (event.source === undefined) {
        annotations.clear();
      } else {
        for (const [id, ann] of annotations) {
          if (ann.source === event.source) annotations.delete(id);
        }
      }
      return { applied: true };
    }

    case 'snapshot':
      // Snapshots are NOT handled by this reducer. A correct snapshot apply
      // must update planMarkdown, seq, AND the annotations map together;
      // handling any of those in isolation risks drift. Production clients
      // use CollabRoomClient.handleRoomSnapshot() for that atomic path.
      return { applied: false, reason: 'snapshots handled by client snapshot path, not this reducer' };

    case 'presence.update':
      // Presence is handled separately by the caller — not a snapshot mutation.
      return { applied: false, reason: 'presence event handled separately' };

    default:
      return { applied: false, reason: 'unknown event type' };
  }
}

/** Return annotations as an ordered array (insertion order preserved). */
export function annotationsToArray(annotations: Map<string, RoomAnnotation>): RoomAnnotation[] {
  return [...annotations.values()];
}
