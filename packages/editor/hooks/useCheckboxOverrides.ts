/**
 * Checkbox Overrides Hook
 *
 * Manages interactive checkbox toggling in the plan viewer. Each toggle creates
 * a COMMENT annotation capturing the action and section context; toggling back
 * to the original state removes the override and deletes the annotation.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Annotation, AnnotationType, Block } from '@plannotator/ui/types';

export interface UseCheckboxOverridesOptions {
  blocks: Block[];
  annotations: Annotation[];
  addAnnotation: (ann: Annotation) => void;
  removeAnnotation: (id: string) => void;
  /**
   * Room-mode only. Block IDs whose checkbox annotation has an
   * UNRESOLVED server op — either in flight (pending add / update /
   * remove) or waiting on user Retry/Discard after a failure. Two
   * roles inside this hook:
   *
   *   1. Busy gate — `toggle()` short-circuits when the block is in
   *      this set so rapid clicks can't stack a second op on top of
   *      one the server hasn't settled. Without this, a user who
   *      clicks twice quickly can end up with a confirmed checkbox
   *      annotation for state they thought they undid, and the
   *      room controller's one-op-per-id pending map has no way to
   *      reconcile the second op against the first.
   *
   *   2. Revert gate — the reconciliation effect treats a block in
   *      this set as still "covered" by a backing annotation, so a
   *      deletion that's in flight or failed doesn't optimistically
   *      clear the visual override before the remove echoes (or
   *      before the user resolves the failure via Retry/Discard).
   *
   * Local mode leaves this undefined; synchronous `toggle` and
   * `revertOverride` calls in App.tsx do the coordination instead.
   */
  pendingBlockIds?: ReadonlySet<string>;
}

export interface UseCheckboxOverridesReturn {
  /** Visual override state passed to the Viewer as `checkboxOverrides` */
  overrides: Map<string, boolean>;
  /** Toggle handler passed to the Viewer as `onToggleCheckbox` */
  toggle: (blockId: string, checked: boolean) => void;
  /** Revert an override when a checkbox annotation is deleted from the panel */
  revertOverride: (blockId: string) => void;
}

export function useCheckboxOverrides({
  blocks,
  annotations,
  addAnnotation,
  removeAnnotation,
  pendingBlockIds,
}: UseCheckboxOverridesOptions): UseCheckboxOverridesReturn {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  // Refs so callbacks don't need annotations/blocks in their dep arrays
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  // Same ref pattern for the pending-blocks set so the toggle callback's
  // identity doesn't change on every pending update (which would churn
  // Viewer/ListMarker re-renders for no reason).
  const pendingBlockIdsRef = useRef(pendingBlockIds);
  pendingBlockIdsRef.current = pendingBlockIds;

  // Clean up stale overrides when blocks change (e.g. markdown reloaded)
  useEffect(() => {
    if (overrides.size === 0) return;
    const blockIds = new Set(blocks.map(b => b.id));
    const stale = [...overrides.keys()].filter(id => !blockIds.has(id));
    if (stale.length > 0) {
      setOverrides(prev => {
        const next = new Map(prev);
        stale.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [blocks]);

  // Reconcile overrides against backing checkbox annotations.
  //
  // Local mode: `toggle` clears the override synchronously alongside
  // the annotation removal, so this effect is usually a no-op. It still
  // provides a safety net for external paths that mutate annotations
  // without going through `toggle` (e.g. share-import loading a plan
  // without the matching checkbox annotations, or draft restore).
  //
  // Room mode: this is the primary mechanism that returns the visual
  // state to the unchecked baseline after a deletion. The delete path
  // in App.tsx intentionally does NOT call `revertOverride` in room
  // mode, because a remove that later fails would strand a
  // visually-reverted checkbox whose canonical annotation still
  // exists. Instead we wait until the block has no checkbox annotation
  // in canonical state AND no unresolved op in `pendingBlockIds`
  // (pending or failed). Both must be empty before we clear — a
  // pending op means the remove is still in flight; a failed op means
  // the annotation still exists canonically and the user has to
  // Retry/Discard first.
  useEffect(() => {
    if (overrides.size === 0) return;
    const coveredBlocks = new Set<string>();
    for (const a of annotations) {
      if (a.id.startsWith('ann-checkbox-')) coveredBlocks.add(a.blockId);
    }
    if (pendingBlockIds) {
      for (const id of pendingBlockIds) coveredBlocks.add(id);
    }
    const toClear = [...overrides.keys()].filter(id => !coveredBlocks.has(id));
    if (toClear.length === 0) return;
    setOverrides(prev => {
      const next = new Map(prev);
      toClear.forEach(id => next.delete(id));
      return next;
    });
  }, [annotations, pendingBlockIds]);

  const toggle = useCallback((blockId: string, checked: boolean) => {
    // Room-mode busy gate: if a checkbox add/update/remove for this
    // block is still in flight with the server, drop the click. The
    // first op has to echo (or fail with Retry/Discard) before we
    // accept another toggle, so the user can't send conflicting ops
    // that the controller can't reconcile against the one-op-per-id
    // pending map.
    if (pendingBlockIdsRef.current?.has(blockId)) return;

    const blocks = blocksRef.current;
    const annotations = annotationsRef.current;
    const block = blocks.find(b => b.id === blockId);
    const isRevertingToOriginal = block && checked === block.checked;

    if (isRevertingToOriginal) {
      // Undo: remove the override and delete ALL checkbox annotations for this block
      setOverrides(prev => {
        const next = new Map(prev);
        next.delete(blockId);
        return next;
      });
      const toDelete = annotations.filter(a => a.blockId === blockId && a.id.startsWith('ann-checkbox-'));
      toDelete.forEach(a => removeAnnotation(a.id));
    } else {
      // Toggle: remove any existing checkbox annotations for this block first (prevents duplicates from rapid clicks)
      const existing = annotations.filter(a => a.blockId === blockId && a.id.startsWith('ann-checkbox-'));
      existing.forEach(a => removeAnnotation(a.id));

      setOverrides(prev => {
        const next = new Map(prev);
        next.set(blockId, checked);
        return next;
      });
      if (block) {
        // Find the nearest heading above this block for section context
        const blockIdx = blocks.indexOf(block);
        let sectionHeading = '';
        for (let i = blockIdx - 1; i >= 0; i--) {
          if (blocks[i].type === 'heading') {
            sectionHeading = blocks[i].content;
            break;
          }
        }

        const action = checked ? 'Mark as completed' : 'Mark as not completed';
        const context = sectionHeading ? ` (under "${sectionHeading}")` : ` (line ${block.startLine})`;
        const ann: Annotation = {
          id: `ann-checkbox-${blockId}-${Date.now()}`,
          blockId,
          startOffset: 0,
          endOffset: block.content.length,
          type: AnnotationType.COMMENT,
          text: `${action}${context}: ${block.content}`,
          originalText: block.content,
          createdA: Date.now(),
        };
        addAnnotation(ann);
      }
    }
  }, [addAnnotation, removeAnnotation]);

  const revertOverride = useCallback((blockId: string) => {
    setOverrides(prev => {
      const next = new Map(prev);
      next.delete(blockId);
      return next;
    });
  }, []);

  return { overrides, toggle, revertOverride };
}
