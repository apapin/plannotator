import { describe, expect, test } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { useAnnotationHighlightReconciler } from './useAnnotationHighlightReconciler';
import type { ViewerHandle } from '../components/Viewer';
import type { Annotation } from '../types';
import { AnnotationType } from '../types';

/**
 * The reconciler was extracted from two duplicate implementations (external
 * SSE + room mode). The `surfaceGeneration` dep is the key invariant: when
 * the Viewer's highlight surface is reset (highlighter reinit,
 * `clearAllHighlights`), the applied map must clear so eligible annotations
 * repaint against the fresh DOM.
 */
describe('useAnnotationHighlightReconciler', () => {
  function makeMockViewer() {
    const applied: Annotation[] = [];
    const removed: string[] = [];
    const handle: ViewerHandle = {
      removeHighlight: (id: string) => { removed.push(id); },
      clearAllHighlights: () => {},
      applySharedAnnotations: (anns: Annotation[]) => { applied.push(...anns); },
    };
    return { handle, applied, removed };
  }

  const ANN_A: Annotation = {
    id: 'a1',
    blockId: 'b1',
    startOffset: 0,
    endOffset: 3,
    type: AnnotationType.COMMENT,
    originalText: 'foo',
    createdA: 0,
    text: 'nit',
  };
  const ANN_B: Annotation = {
    id: 'b2',
    blockId: 'b2',
    startOffset: 0,
    endOffset: 3,
    type: AnnotationType.COMMENT,
    originalText: 'bar',
    createdA: 0,
    text: 'here',
  };

  test('applies eligible annotations once', async () => {
    const { handle, applied } = makeMockViewer();
    renderHook(() => {
      const ref = useRef<ViewerHandle>(handle);
      return useAnnotationHighlightReconciler({
        viewerRef: ref,
        annotations: [ANN_A, ANN_B],
        enabled: true,
        planKey: 'plan-1',
        surfaceGeneration: 1,
        eligibleFilter: a => !!a.originalText,
        paintDelayMs: 0,
      });
    });

    await waitFor(() => {
      expect(applied.length).toBe(2);
    });
    expect(applied.map(a => a.id).sort()).toEqual(['a1', 'b2']);
  });

  test('bumping surfaceGeneration clears the applied map and repaints', async () => {
    const { handle, applied } = makeMockViewer();

    let generation = 1;
    const { rerender } = renderHook(() => {
      const ref = useRef<ViewerHandle>(handle);
      return useAnnotationHighlightReconciler({
        viewerRef: ref,
        annotations: [ANN_A],
        enabled: true,
        planKey: 'plan-1',
        surfaceGeneration: generation,
        eligibleFilter: a => !!a.originalText,
        paintDelayMs: 0,
      });
    });

    await waitFor(() => {
      expect(applied.length).toBe(1);
    });

    // Simulate the Viewer resetting its highlight surface — in App.tsx this
    // happens when `Viewer.clearAllHighlights()` fires `onHighlightSurfaceReset`,
    // and the parent bumps the generation counter in response.
    generation = 2;
    rerender();

    await waitFor(() => {
      expect(applied.length).toBe(2);
    });
    // Same annotation id should have been reapplied the second time.
    expect(applied.filter(a => a.id === 'a1').length).toBe(2);
  });

  test('fingerprint change triggers remove+reapply', async () => {
    const { handle, applied, removed } = makeMockViewer();

    let annotation: Annotation = { ...ANN_A, text: 'nit' };
    const { rerender } = renderHook(() => {
      const ref = useRef<ViewerHandle>(handle);
      return useAnnotationHighlightReconciler<Annotation>({
        viewerRef: ref,
        annotations: [annotation],
        enabled: true,
        planKey: 'plan-1',
        surfaceGeneration: 1,
        fingerprint: a => `${a.type}\u0000${a.originalText}\u0000${a.text ?? ''}`,
        paintDelayMs: 0,
      });
    });

    await waitFor(() => {
      expect(applied.length).toBe(1);
    });

    // Peer updated the comment text; fingerprint changes → remove + reapply.
    annotation = { ...annotation, text: 'actually blocking' };
    rerender();

    await waitFor(() => {
      expect(removed).toContain('a1');
      expect(applied.length).toBe(2);
    });
  });

  test('disabled does not apply', async () => {
    const { handle, applied } = makeMockViewer();

    renderHook(() => {
      const ref = useRef<ViewerHandle>(handle);
      return useAnnotationHighlightReconciler({
        viewerRef: ref,
        annotations: [ANN_A],
        enabled: false,
        planKey: 'plan-1',
        surfaceGeneration: 1,
        paintDelayMs: 0,
      });
    });

    // Wait a tick — without `enabled`, the effect should no-op and nothing
    // should land in `applied`.
    await new Promise(r => setTimeout(r, 30));
    expect(applied.length).toBe(0);
  });
});
