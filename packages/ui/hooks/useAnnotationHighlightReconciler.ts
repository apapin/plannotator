/**
 * Generic annotation → DOM highlight reconciler.
 *
 * Two callers:
 *   - `useExternalAnnotationHighlights` — SSE-delivered external annotations.
 *   - `App.tsx` (room-mode) — server-authoritative room annotations.
 *
 * Both need identical bookkeeping: "which annotation IDs are currently
 * materialized as DOM highlights, and with which fingerprint," so that
 *   (a) removals are dropped from the DOM,
 *   (b) updates trigger remove+reapply,
 *   (c) adds get applied after a paint tick (the Viewer's DOM may not be
 *       mounted yet on initial snapshot load).
 *
 * The applied-map is cleared on two signals:
 *   - `planKey` change — plan markdown changed; the Viewer re-parsed
 *     blocks and wiped marks, so any "already applied" tracking is stale.
 *   - `surfaceGeneration` change — the Viewer's underlying highlighter
 *     was reinitialized or explicitly cleared (e.g. `clearAllHighlights`
 *     during a share-import). Same invariant: DOM marks are gone, tracking
 *     must reset so every eligible annotation repaints.
 *
 * The `reset()` escape hatch exists for callers that can't observe a
 * surface generation bump but know their surface was reset out-of-band.
 * New callers should prefer wiring `surfaceGeneration` instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation } from '../types';
import type { ViewerHandle } from '../components/Viewer';

export interface UseAnnotationHighlightReconcilerOptions<A extends { id: string }> {
  viewerRef: React.RefObject<ViewerHandle | null>;
  annotations: A[];
  enabled: boolean;
  /** Bump to force a full re-apply when plan content changes. */
  planKey: string;
  /**
   * Monotonic counter from `Viewer` that increments whenever the
   * underlying highlight surface is (re)initialized or cleared.
   * Starts at 0 before Viewer has emitted; first Viewer-side bump is 1.
   */
  surfaceGeneration: number;
  /**
   * Decide which annotations take part. Default: all.
   * Ineligible annotations are never added to the applied map and
   * are proactively removed if present.
   */
  eligibleFilter?: (annotation: A) => boolean;
  /**
   * Fingerprint an annotation. Fingerprint changes trigger
   * remove+reapply. Default: identity (`id`), meaning updates never
   * repaint — most callers override this.
   */
  fingerprint?: (annotation: A) => string;
  /**
   * How long to wait before walking the DOM to apply marks. Default 100ms
   * to match the historical paint-delay used across drafts/shares.
   */
  paintDelayMs?: number;
}

export interface UseAnnotationHighlightReconcilerReturn {
  /**
   * Force a full re-apply on the next tick. Most callers should prefer
   * bumping `surfaceGeneration` from the Viewer side instead; this exists
   * for paths that don't own the surface (e.g. legacy share-import).
   */
  reset: () => void;
}

export function useAnnotationHighlightReconciler<A extends { id: string }>(
  params: UseAnnotationHighlightReconcilerOptions<A> & {
    // Generic `A`-shaped applySharedAnnotations payload — the Viewer
    // handle types it as `Annotation[]`. Internal narrow.
    _applyAs?: (annotation: A) => Annotation;
  },
): UseAnnotationHighlightReconcilerReturn {
  const {
    viewerRef,
    annotations,
    enabled,
    planKey,
    surfaceGeneration,
    eligibleFilter,
    fingerprint,
    paintDelayMs = 100,
  } = params;

  const appliedRef = useRef<Map<string, string>>(new Map());
  const [resetCount, setResetCount] = useState(0);

  // Clear tracking on surface-identity changes. `planKey` covers markdown
  // reparses; `surfaceGeneration` covers Viewer-internal resets (highlighter
  // reinit, `clearAllHighlights`).
  useEffect(() => {
    appliedRef.current.clear();
  }, [planKey, surfaceGeneration]);

  useEffect(() => {
    if (!enabled) return;
    const viewer = viewerRef.current;
    if (!viewer) return;

    const filter = eligibleFilter ?? (() => true);
    const fp = fingerprint ?? ((a: A) => a.id);

    const eligible = annotations.filter(filter);
    const eligibleById = new Map(eligible.map(a => [a.id, a]));
    const applied = appliedRef.current;

    // 1. Remove: applied IDs no longer eligible, or whose fingerprint drifted.
    for (const [id, storedFp] of applied) {
      const ann = eligibleById.get(id);
      if (!ann || fp(ann) !== storedFp) {
        viewer.removeHighlight(id);
        applied.delete(id);
      }
    }

    // 2. Apply: eligible IDs not yet recorded.
    const toApply = eligible.filter(a => !applied.has(a.id));
    if (toApply.length === 0) return;

    const timer = setTimeout(() => {
      const v = viewerRef.current;
      if (!v) return;
      // Viewer's imperative API takes the UI `Annotation` shape. Callers
      // supply annotation objects that either ARE that shape (external)
      // or are assignment-compatible at runtime (room — `RoomAnnotation`
      // has the required fields minus `images`). The viewer's apply path
      // reads only `id`/`type`/`originalText`, so the cast is safe.
      v.applySharedAnnotations(toApply as unknown as Annotation[]);
      for (const a of toApply) {
        applied.set(a.id, fp(a));
      }
    }, paintDelayMs);

    return () => clearTimeout(timer);
    // viewerRef is a stable ref object; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, enabled, planKey, surfaceGeneration, resetCount, paintDelayMs]);

  const reset = useCallback(() => {
    appliedRef.current.clear();
    setResetCount(c => c + 1);
  }, []);

  return { reset };
}
