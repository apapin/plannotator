import { AnnotationType, type Annotation } from '../types';
import type { ViewerHandle } from '../components/Viewer';
import {
  useAnnotationHighlightReconciler,
  type UseAnnotationHighlightReconcilerReturn,
} from './useAnnotationHighlightReconciler';

/**
 * Bridges SSE-delivered external annotations into the Viewer's imperative
 * highlight API so tools can POST annotations with `originalText` and have
 * them highlight real spans of the rendered plan.
 *
 * This is a thin wrapper around `useAnnotationHighlightReconciler` that
 * pins the external-specific eligibility filter and fingerprint. The
 * reconciler is also used by room mode in `App.tsx`; keeping a named
 * external-facing hook preserves existing call sites and keeps the
 * external fingerprint (which deliberately excludes comment `text`)
 * distinct from the room fingerprint.
 *
 * - Annotations without `originalText` (or `GLOBAL_COMMENT`) stay sidebar-only.
 * - Annotations with `diffContext` are skipped (diff view owns those).
 * - The Viewer's `onHighlightSurfaceReset` event bumps the parent-owned
 *   generation counter; callers thread that counter in via
 *   `surfaceGeneration` so reconcilers automatically repaint when the
 *   highlighter surface is reset (e.g. `clearAllHighlights` during share
 *   import, or a Viewer remount). The `reset()` escape hatch remains for
 *   paths that can't wire a generation signal.
 * - Disabled state no-ops WITHOUT clearing the applied set. This preserves
 *   the bookkeeping while the Viewer DOM is hidden (diff view / linked doc)
 *   so any SSE removals that arrive while hidden reconcile on re-enable.
 */
export function useExternalAnnotationHighlights(params: {
  viewerRef: React.RefObject<ViewerHandle | null>;
  externalAnnotations: Annotation[];
  enabled: boolean;
  /** Bump to force a full re-apply (e.g. plan markdown changed and blocks re-rendered). */
  planKey: string;
  /** Monotonic counter from Viewer; clears tracking on highlighter reset. Default 0. */
  surfaceGeneration?: number;
}): UseAnnotationHighlightReconcilerReturn {
  const { viewerRef, externalAnnotations, enabled, planKey, surfaceGeneration = 0 } = params;

  return useAnnotationHighlightReconciler<Annotation>({
    viewerRef,
    annotations: externalAnnotations,
    enabled,
    planKey,
    surfaceGeneration,
    eligibleFilter: externalEligible,
    fingerprint: externalFingerprint,
  });
}

function externalEligible(a: Annotation): boolean {
  return a.type !== AnnotationType.GLOBAL_COMMENT && !a.diffContext && !!a.originalText;
}

// External annotations can be updated by tools via PATCH, but the apply
// path keys off `originalText`; comment `text` changes do not require
// repainting the mark. Keep the external fingerprint focused on the
// fields the DOM surface actually depends on.
function externalFingerprint(a: Annotation): string {
  return `${a.type}\u0000${a.originalText}`;
}
