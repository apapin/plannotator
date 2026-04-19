import { describe, expect, test } from 'bun:test';
import { applyAnnotationEvent, annotationsToArray } from './apply-event';
import type { RoomAnnotation, RoomServerEvent, RoomSnapshot } from '../types';

function makeAnnotation(id: string, extras: Partial<RoomAnnotation> = {}): RoomAnnotation {
  return {
    id,
    blockId: 'b1',
    startOffset: 0,
    endOffset: 5,
    type: 'COMMENT',
    originalText: 'hello',
    createdA: 1234567890,
    ...extras,
  };
}

describe('applyAnnotationEvent', () => {
  test('annotation.add inserts annotations', () => {
    const map = new Map<string, RoomAnnotation>();
    const event: RoomServerEvent = {
      type: 'annotation.add',
      annotations: [makeAnnotation('a1'), makeAnnotation('a2')],
    };
    const result = applyAnnotationEvent(map, event);
    expect(result.applied).toBe(true);
    expect(map.size).toBe(2);
    expect(map.has('a1')).toBe(true);
    expect(map.has('a2')).toBe(true);
  });

  test('annotation.update merges patch into existing', () => {
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1', { text: 'original' }));
    const event: RoomServerEvent = {
      type: 'annotation.update',
      id: 'a1',
      patch: { text: 'updated' },
    };
    const result = applyAnnotationEvent(map, event);
    expect(result.applied).toBe(true);
    expect(map.get('a1')?.text).toBe('updated');
  });

  test('annotation.update drops own-property undefined values from patch (normalization)', () => {
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1', { text: 'original', author: 'alice' }));
    const event: RoomServerEvent = {
      type: 'annotation.update',
      id: 'a1',
      // Direct in-process caller passes undefined — must be dropped, not
      // stored as an own key with value undefined.
      patch: { text: 'updated', author: undefined } as Partial<RoomAnnotation>,
    };
    applyAnnotationEvent(map, event);
    const stored = map.get('a1')!;
    expect(stored.text).toBe('updated');
    // author must still be 'alice' — the undefined patch must not have erased it.
    expect(stored.author).toBe('alice');
    // And own-property check: the stored object must NOT have an own `author: undefined` slot.
    expect('author' in stored).toBe(true);
    expect(stored.author).not.toBeUndefined();
  });

  test('annotation.update rejects when merged final annotation violates cross-field invariants', () => {
    // Inline annotations (COMMENT/DELETION) must have non-empty blockId. A
    // patch that sets blockId: '' on a COMMENT passes the patch-level
    // validator (blockId is just a string) but produces an invalid merged
    // final annotation. The reducer must validate the merged state and
    // refuse to store the invalid result.
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1'));  // COMMENT with blockId: 'b1'
    const originalBlockId = map.get('a1')!.blockId;

    const event: RoomServerEvent = {
      type: 'annotation.update',
      id: 'a1',
      patch: { blockId: '' } as Partial<RoomAnnotation>,
    };
    const result = applyAnnotationEvent(map, event);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('failed shape validation');
    // Stored annotation is untouched — blockId is still non-empty.
    expect(map.get('a1')!.blockId).toBe(originalBlockId);
  });

  test('annotation.update rejects when patching type turns existing annotation into an invalid inline (empty blockId)', () => {
    // A GLOBAL_COMMENT legitimately carries blockId: ''. Patching its type
    // to COMMENT produces an invalid final state (inline requires non-empty
    // blockId). Must reject.
    const map = new Map<string, RoomAnnotation>();
    map.set('g1', makeAnnotation('g1', { type: 'GLOBAL_COMMENT', blockId: '' }));
    const event: RoomServerEvent = {
      type: 'annotation.update',
      id: 'g1',
      patch: { type: 'COMMENT' },
    };
    const result = applyAnnotationEvent(map, event);
    expect(result.applied).toBe(false);
    // Stored annotation type is untouched.
    expect(map.get('g1')!.type).toBe('GLOBAL_COMMENT');
  });

  test('annotation.update defensively preserves existing.id even if patch slipped in a mismatched id', () => {
    // Defense-in-depth against identity-mutation: isRoomAnnotationPatch
    // already rejects id in patches. The reducer ALSO forces existing.id so
    // that if a malformed patch ever reached here, we'd still store the
    // annotation under the correct id.
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1', { text: 'original' }));
    const event: RoomServerEvent = {
      type: 'annotation.update',
      id: 'a1',
      patch: { id: 'hijacked', text: 'updated' } as Partial<RoomAnnotation>,
    };
    const result = applyAnnotationEvent(map, event);
    expect(result.applied).toBe(true);
    expect(map.size).toBe(1);
    expect(map.has('a1')).toBe(true);
    expect(map.has('hijacked')).toBe(false);
    const stored = map.get('a1')!;
    expect(stored.id).toBe('a1');             // internal id unchanged
    expect(stored.text).toBe('updated');       // other fields still patched
  });

  test('annotation.update isolates nested startMeta/endMeta between input patch and stored annotation', () => {
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1', {
      startMeta: { parentTagName: 'p', parentIndex: 0, textOffset: 0 },
    }));
    const patch: Partial<RoomAnnotation> = {
      startMeta: { parentTagName: 'div', parentIndex: 1, textOffset: 5 },
      endMeta: { parentTagName: 'div', parentIndex: 1, textOffset: 10 },
    };
    const event: RoomServerEvent = { type: 'annotation.update', id: 'a1', patch };
    applyAnnotationEvent(map, event);

    // Mutate the INPUT patch's nested meta objects after apply.
    patch.startMeta!.parentTagName = 'HIJACKED';
    patch.endMeta!.textOffset = 999;

    const stored = map.get('a1')!;
    // Stored annotation must be unaffected.
    expect(stored.startMeta!.parentTagName).toBe('div');
    expect(stored.startMeta!.textOffset).toBe(5);
    expect(stored.endMeta!.textOffset).toBe(10);
  });

  test('annotation.update on missing id is a no-op', () => {
    const map = new Map<string, RoomAnnotation>();
    const event: RoomServerEvent = {
      type: 'annotation.update',
      id: 'missing',
      patch: { text: 'x' },
    };
    const result = applyAnnotationEvent(map, event);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('not found');
    expect(map.size).toBe(0);
  });

  test('annotation.remove deletes ids', () => {
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1'));
    map.set('a2', makeAnnotation('a2'));
    map.set('a3', makeAnnotation('a3'));
    const event: RoomServerEvent = {
      type: 'annotation.remove',
      ids: ['a1', 'a3'],
    };
    applyAnnotationEvent(map, event);
    expect(map.has('a1')).toBe(false);
    expect(map.has('a2')).toBe(true);
    expect(map.has('a3')).toBe(false);
  });

  test('annotation.clear without source clears all', () => {
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1'));
    map.set('a2', makeAnnotation('a2', { source: 'eslint' }));
    applyAnnotationEvent(map, { type: 'annotation.clear' });
    expect(map.size).toBe(0);
  });

  test('annotation.clear with source only removes matching', () => {
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1'));
    map.set('a2', makeAnnotation('a2', { source: 'eslint' }));
    map.set('a3', makeAnnotation('a3', { source: 'eslint' }));
    applyAnnotationEvent(map, { type: 'annotation.clear', source: 'eslint' });
    expect(map.has('a1')).toBe(true);
    expect(map.has('a2')).toBe(false);
    expect(map.has('a3')).toBe(false);
  });

  test('snapshot is NOT handled here — production uses CollabRoomClient.handleRoomSnapshot()', () => {
    // Snapshots must atomically update planMarkdown + seq + annotations,
    // which this reducer cannot do. The client's snapshot path is the sole
    // entry point; this reducer returns applied: false so any accidental
    // caller gets a loud no-op rather than a half-applied snapshot.
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1'));
    const snapshot: RoomSnapshot = {
      versionId: 'v1',
      planMarkdown: '# Plan',
      annotations: [makeAnnotation('b1'), makeAnnotation('b2')],
    };
    const result = applyAnnotationEvent(map, { type: 'snapshot', payload: snapshot, snapshotSeq: 5 });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('snapshot');
    // Map is untouched.
    expect(map.size).toBe(1);
    expect(map.has('a1')).toBe(true);
  });

  test('presence.update is not handled here', () => {
    const map = new Map<string, RoomAnnotation>();
    const result = applyAnnotationEvent(map, {
      type: 'presence.update',
      clientId: 'c1',
      presence: {
        user: { id: 'u1', name: 'alice', color: '#f00' },
        cursor: null,
      },
    });
    expect(result.applied).toBe(false);
  });
});

describe('annotationsToArray', () => {
  test('returns array in insertion order', () => {
    const map = new Map<string, RoomAnnotation>();
    map.set('a1', makeAnnotation('a1'));
    map.set('a2', makeAnnotation('a2'));
    map.set('a3', makeAnnotation('a3'));
    const arr = annotationsToArray(map);
    expect(arr.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  test('empty map returns empty array', () => {
    expect(annotationsToArray(new Map())).toEqual([]);
  });
});
