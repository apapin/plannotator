import { describe, expect, test, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useCheckboxOverrides } from './useCheckboxOverrides';
import { AnnotationType, type Annotation, type Block } from '@plannotator/ui/types';

/**
 * Coverage scope — the invariants that matter for the room-mode
 * pending/revert race. Happy-dom is provided by packages/editor/bunfig.toml
 * (shares packages/ui/test-setup.ts) so `renderHook` has a DOM global.
 *
 *   - busy gate: toggle() short-circuits when the block is pending
 *   - revert gate: override persists while canonical OR pending/failed
 *     covers the block
 *   - eventual revert: both canonical + pending/failed must be empty
 *     before the override clears
 *   - local-mode parity: when `pendingBlockIds` is undefined (local
 *     mode), the reconciliation effect still drops overrides whose
 *     canonical annotation was removed externally
 */

function makeBlock(id: string, content = 'item'): Block {
  return { id, type: 'list-item', content, order: 0, startLine: 0, checked: false };
}

function makeCheckboxAnnotation(blockId: string, id = `ann-checkbox-${blockId}-1`): Annotation {
  return {
    id,
    blockId,
    startOffset: 0,
    endOffset: 4,
    type: AnnotationType.COMMENT,
    text: 'Mark as completed',
    originalText: 'item',
    createdA: 1,
  };
}

describe('useCheckboxOverrides — busy gate', () => {
  test('toggle() short-circuits when pendingBlockIds includes the block', () => {
    const addAnnotation = mock(() => {});
    const removeAnnotation = mock(() => {});
    const block = makeBlock('b1');
    const pendingBlockIds = new Set(['b1']);

    const { result } = renderHook(() =>
      useCheckboxOverrides({
        blocks: [block],
        annotations: [],
        addAnnotation,
        removeAnnotation,
        pendingBlockIds,
      }),
    );

    act(() => {
      result.current.toggle('b1', true);
    });

    expect(addAnnotation).not.toHaveBeenCalled();
    expect(removeAnnotation).not.toHaveBeenCalled();
    // Visual override must also NOT change — busy means "drop the click
    // entirely," not "change visuals but skip the server call."
    expect(result.current.overrides.has('b1')).toBe(false);
  });

  test('toggle() proceeds for a block not in pendingBlockIds', () => {
    const addAnnotation = mock(() => {});
    const removeAnnotation = mock(() => {});
    const block = makeBlock('b1');

    const { result } = renderHook(() =>
      useCheckboxOverrides({
        blocks: [block],
        annotations: [],
        addAnnotation,
        removeAnnotation,
        pendingBlockIds: new Set(['b-other']),
      }),
    );

    act(() => {
      result.current.toggle('b1', true);
    });

    // Core busy-gate invariant: when the block is NOT pending, the
    // toggle reaches the outbound path. Override lifecycle after the
    // call is a reconciliation concern and is covered separately —
    // a bare mock caller doesn't feed the optimistic-add back into
    // `pendingBlockIds` the way App.tsx does, so asserting the
    // override post-toggle in this harness would test test-plumbing,
    // not the hook.
    expect(addAnnotation).toHaveBeenCalledTimes(1);
  });
});

describe('useCheckboxOverrides — reconciliation', () => {
  test('override persists while pendingBlockIds covers the block (no canonical yet)', () => {
    const block = makeBlock('b1');

    const { result, rerender } = renderHook(
      ({ annotations, pendingBlockIds }: {
        annotations: Annotation[];
        pendingBlockIds: ReadonlySet<string>;
      }) =>
        useCheckboxOverrides({
          blocks: [block],
          annotations,
          addAnnotation: () => {},
          removeAnnotation: () => {},
          pendingBlockIds,
        }),
      { initialProps: { annotations: [], pendingBlockIds: new Set<string>() } },
    );

    act(() => {
      result.current.toggle('b1', true);
    });
    expect(result.current.overrides.get('b1')).toBe(true);

    // Optimistic add is in flight — no canonical yet, but pendingBlockIds
    // covers the block. Reconciliation must NOT clear the override.
    rerender({ annotations: [], pendingBlockIds: new Set(['b1']) });
    expect(result.current.overrides.get('b1')).toBe(true);

    // Pending fails — moves into `failed`. App.tsx still reports the
    // block in `pendingBlockIds` (failed entries are included). Override
    // must still be preserved; only Discard clears failed, and even then
    // only if no canonical exists.
    rerender({ annotations: [], pendingBlockIds: new Set(['b1']) });
    expect(result.current.overrides.get('b1')).toBe(true);
  });

  test('override clears once both canonical and pending/failed coverage are gone', () => {
    const block = makeBlock('b1');
    const ann = makeCheckboxAnnotation('b1');

    const { result, rerender } = renderHook(
      ({ annotations, pendingBlockIds }: {
        annotations: Annotation[];
        pendingBlockIds: ReadonlySet<string>;
      }) =>
        useCheckboxOverrides({
          blocks: [block],
          annotations,
          addAnnotation: () => {},
          removeAnnotation: () => {},
          pendingBlockIds,
        }),
      { initialProps: { annotations: [ann], pendingBlockIds: new Set<string>() } },
    );

    act(() => {
      result.current.toggle('b1', true);
    });
    expect(result.current.overrides.get('b1')).toBe(true);

    // Simulate a pending remove: canonical still present, pendingBlockIds
    // covers. Override stays.
    rerender({ annotations: [ann], pendingBlockIds: new Set(['b1']) });
    expect(result.current.overrides.get('b1')).toBe(true);

    // Echo arrives — canonical drops, pending clears. Both coverage sets
    // empty → override clears.
    rerender({ annotations: [], pendingBlockIds: new Set<string>() });
    expect(result.current.overrides.has('b1')).toBe(false);
  });

  test('local mode (pendingBlockIds undefined) still drops overrides whose canonical went away', () => {
    const block = makeBlock('b1');
    const ann = makeCheckboxAnnotation('b1');

    const { result, rerender } = renderHook(
      ({ annotations }: { annotations: Annotation[] }) =>
        useCheckboxOverrides({
          blocks: [block],
          annotations,
          addAnnotation: () => {},
          removeAnnotation: () => {},
          // pendingBlockIds intentionally undefined for local mode
        }),
      { initialProps: { annotations: [ann] } },
    );

    act(() => {
      result.current.toggle('b1', true);
    });
    expect(result.current.overrides.get('b1')).toBe(true);

    // An external path wipes the canonical checkbox annotation (e.g.
    // draft-restore loading a plan without it). Reconciliation clears.
    rerender({ annotations: [] });
    expect(result.current.overrides.has('b1')).toBe(false);
  });
});
