import { act } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useAnnotationController } from './useAnnotationController';
import { AnnotationType, type Annotation } from '../types';

function makeAnn(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    blockId: 'b1',
    startOffset: 0,
    endOffset: 5,
    type: AnnotationType.COMMENT,
    text: `text ${id}`,
    originalText: 'hello',
    createdA: Date.now(),
    ...overrides,
  };
}

describe('useAnnotationController — local mode', () => {
  test('starts empty with no pending/failed/pendingAdditions', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    expect(result.current.mode).toBe('local');
    expect(result.current.annotations).toEqual([]);
    expect(result.current.pending.size).toBe(0);
    expect(result.current.failed.size).toBe(0);
    expect(result.current.pendingAdditions.size).toBe(0);
  });

  test('add appends to the list', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    act(() => result.current.add(makeAnn('a')));
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].id).toBe('a');
  });

  test('update patches a specific id', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    act(() => result.current.add(makeAnn('a', { text: 'before' })));
    act(() => result.current.update('a', { text: 'after' }));
    expect(result.current.annotations[0].text).toBe('after');
  });

  test('update on unknown id is a no-op', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    act(() => result.current.add(makeAnn('a')));
    act(() => result.current.update('missing', { text: 'x' }));
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].text).toBe('text a');
  });

  test('remove drops the matching id', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    act(() => {
      result.current.add(makeAnn('a'));
      result.current.add(makeAnn('b'));
    });
    act(() => result.current.remove('a'));
    expect(result.current.annotations.map(a => a.id)).toEqual(['b']);
  });

  test('clear() without source removes all', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    act(() => {
      result.current.add(makeAnn('a'));
      result.current.add(makeAnn('b'));
    });
    act(() => result.current.clear());
    expect(result.current.annotations).toEqual([]);
  });

  test('clear(source) removes only matching source', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    act(() => {
      result.current.add(makeAnn('a', { source: 'eslint' }));
      result.current.add(makeAnn('b', { source: 'prettier' }));
      result.current.add(makeAnn('c'));  // no source
    });
    act(() => result.current.clear('eslint'));
    expect(result.current.annotations.map(a => a.id).sort()).toEqual(['b', 'c']);
  });

  test('setAll performs atomic replace-all', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    act(() => result.current.add(makeAnn('a')));
    act(() => result.current.setAll!([makeAnn('x'), makeAnn('y')]));
    expect(result.current.annotations.map(a => a.id)).toEqual(['x', 'y']);
  });

  test('respects initial annotations', () => {
    const initial = [makeAnn('a'), makeAnn('b')];
    const { result } = renderHook(() => useAnnotationController({ initial }));
    expect(result.current.annotations).toHaveLength(2);
  });

  test('retry/discard are undefined in local mode', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    expect(result.current.retry).toBeUndefined();
    expect(result.current.discard).toBeUndefined();
  });

  test('isLocked is undefined in local mode', () => {
    const { result } = renderHook(() => useAnnotationController({}));
    expect(result.current.isLocked).toBeUndefined();
  });
});
