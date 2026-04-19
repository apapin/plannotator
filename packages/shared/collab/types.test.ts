/**
 * Unit tests for runtime validators — isPresenceState, isRoomAnnotation,
 * isRoomAnnotationPatch, isRoomClientOp, isRoomSnapshot.
 *
 * These validators run on the client after decryption to reject structurally
 * malformed payloads before they enter client state. Coverage focuses on
 * edge cases that could crash UI render paths.
 */

import { describe, expect, test } from 'bun:test';
import {
  isPresenceState,
  isRoomAnnotation,
  isRoomAnnotationPatch,
  isRoomClientOp,
  isRoomSnapshot,
  type RoomAnnotation,
} from './types';

const GOOD_ANN: RoomAnnotation = {
  id: 'ann-1',
  blockId: 'b1',
  startOffset: 0,
  endOffset: 5,
  type: 'COMMENT',
  originalText: 'hello',
  createdA: 1234,
};

describe('isRoomAnnotation', () => {
  test('accepts a minimal valid annotation', () => {
    expect(isRoomAnnotation(GOOD_ANN)).toBe(true);
  });

  test('accepts an annotation with all optional fields', () => {
    expect(isRoomAnnotation({
      ...GOOD_ANN,
      text: 'my comment',
      author: 'alice',
      source: 'eslint',
      isQuickLabel: true,
      quickLabelTip: 'tip',
      diffContext: 'added',
      startMeta: { parentTagName: 'p', parentIndex: 0, textOffset: 3 },
      endMeta: { parentTagName: 'p', parentIndex: 0, textOffset: 8 },
    })).toBe(true);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'not-an-obj'],
    ['number', 42],
    ['array', [GOOD_ANN]],
  ])('rejects non-object: %s', (_label, input) => {
    expect(isRoomAnnotation(input)).toBe(false);
  });

  test('rejects null id', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, id: null })).toBe(false);
  });

  test('rejects empty id', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, id: '' })).toBe(false);
  });

  test('rejects null type', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, type: null })).toBe(false);
  });

  test('rejects unknown type enum', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, type: 'SOMETHING_ELSE' })).toBe(false);
  });

  test('rejects non-string originalText', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, originalText: 42 })).toBe(false);
    expect(isRoomAnnotation({ ...GOOD_ANN, originalText: null })).toBe(false);
  });

  test('rejects non-finite offsets', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, startOffset: NaN })).toBe(false);
    expect(isRoomAnnotation({ ...GOOD_ANN, endOffset: Infinity })).toBe(false);
  });

  test('rejects wrong-typed optionals', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, text: 42 })).toBe(false);
    expect(isRoomAnnotation({ ...GOOD_ANN, author: true })).toBe(false);
    expect(isRoomAnnotation({ ...GOOD_ANN, isQuickLabel: 'yes' })).toBe(false);
    expect(isRoomAnnotation({ ...GOOD_ANN, diffContext: 'unexpected' })).toBe(false);
  });

  test('rejects malformed startMeta', () => {
    expect(isRoomAnnotation({
      ...GOOD_ANN,
      startMeta: { parentTagName: 'p', parentIndex: 'x', textOffset: 3 },
    })).toBe(false);
  });

  test('rejects presence of images field (V1 room annotations have no images)', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, images: [{ path: '/t', name: 'n' }] })).toBe(false);
  });

  test('inline annotations (COMMENT, DELETION) require non-empty blockId', () => {
    expect(isRoomAnnotation({ ...GOOD_ANN, type: 'COMMENT', blockId: '' })).toBe(false);
    expect(isRoomAnnotation({ ...GOOD_ANN, type: 'DELETION', blockId: '' })).toBe(false);
  });

  test('GLOBAL_COMMENT is allowed to carry blockId: "" (matches existing UI convention)', () => {
    expect(isRoomAnnotation({
      ...GOOD_ANN,
      type: 'GLOBAL_COMMENT',
      blockId: '',
    })).toBe(true);
  });
});

describe('isRoomAnnotationPatch', () => {
  test('rejects empty patch (no defined allowed fields — would burn a seq for a no-op)', () => {
    expect(isRoomAnnotationPatch({})).toBe(false);
  });

  test('rejects patch where every field is explicitly undefined', () => {
    expect(isRoomAnnotationPatch({ text: undefined })).toBe(false);
    expect(isRoomAnnotationPatch({ text: undefined, author: undefined })).toBe(false);
  });

  test('accepts single-field patches', () => {
    expect(isRoomAnnotationPatch({ text: 'new' })).toBe(true);
    expect(isRoomAnnotationPatch({ type: 'DELETION' })).toBe(true);
    expect(isRoomAnnotationPatch({ diffContext: 'modified' })).toBe(true);
  });

  test('rejects patch that sets required field to invalid value', () => {
    expect(isRoomAnnotationPatch({ type: null })).toBe(false);
    expect(isRoomAnnotationPatch({ originalText: 42 })).toBe(false);
    expect(isRoomAnnotationPatch({ startOffset: NaN })).toBe(false);
  });

  test('rejects patch that tries to mutate annotation id (identity-mutation attack)', () => {
    // Even a well-formed string id is rejected — an annotation.update must
    // never change the id of an existing annotation.
    expect(isRoomAnnotationPatch({ id: 'other-id' })).toBe(false);
    expect(isRoomAnnotationPatch({ id: '' })).toBe(false);
  });

  test('rejects patch that tries to add images field', () => {
    expect(isRoomAnnotationPatch({ images: [{ path: '/x', name: 'x' }] })).toBe(false);
  });
});

describe('isRoomClientOp', () => {
  test('accepts annotation.add with valid annotations', () => {
    expect(isRoomClientOp({ type: 'annotation.add', annotations: [GOOD_ANN] })).toBe(true);
  });

  test('rejects annotation.add with malformed annotation', () => {
    expect(isRoomClientOp({
      type: 'annotation.add',
      annotations: [{ ...GOOD_ANN, type: null }],
    })).toBe(false);
  });

  test('rejects annotation.add with non-array annotations', () => {
    expect(isRoomClientOp({ type: 'annotation.add', annotations: GOOD_ANN })).toBe(false);
  });

  test('rejects annotation.add with empty array (no-op would burn a seq)', () => {
    expect(isRoomClientOp({ type: 'annotation.add', annotations: [] })).toBe(false);
  });

  test('rejects annotation.remove with empty ids array (no-op would burn a seq)', () => {
    expect(isRoomClientOp({ type: 'annotation.remove', ids: [] })).toBe(false);
  });

  test('accepts annotation.update with valid patch', () => {
    expect(isRoomClientOp({
      type: 'annotation.update', id: 'ann-1', patch: { text: 'new' },
    })).toBe(true);
  });

  test('rejects annotation.update with empty id', () => {
    expect(isRoomClientOp({
      type: 'annotation.update', id: '', patch: {},
    })).toBe(false);
  });

  test('rejects annotation.update with invalid patch', () => {
    expect(isRoomClientOp({
      type: 'annotation.update', id: 'ann-1', patch: { type: 'BAD' },
    })).toBe(false);
  });

  test('accepts annotation.remove with string ids', () => {
    expect(isRoomClientOp({ type: 'annotation.remove', ids: ['a', 'b'] })).toBe(true);
  });

  test('rejects annotation.remove with empty-string id', () => {
    expect(isRoomClientOp({ type: 'annotation.remove', ids: [''] })).toBe(false);
  });

  test('accepts annotation.clear with and without source', () => {
    expect(isRoomClientOp({ type: 'annotation.clear' })).toBe(true);
    expect(isRoomClientOp({ type: 'annotation.clear', source: 'eslint' })).toBe(true);
  });

  test('rejects unknown op type', () => {
    expect(isRoomClientOp({ type: 'annotation.explode' })).toBe(false);
  });

  test('accepts presence.update with valid PresenceState', () => {
    expect(isRoomClientOp({
      type: 'presence.update',
      presence: { user: { id: 'u', name: 'n', color: '#f00' }, cursor: null },
    })).toBe(true);
  });

  test('rejects presence.update with malformed presence', () => {
    expect(isRoomClientOp({
      type: 'presence.update',
      presence: { user: { id: 'u', name: 42, color: '#f00' }, cursor: null },
    })).toBe(false);
  });
});

describe('isRoomSnapshot', () => {
  test('accepts a minimal valid snapshot', () => {
    expect(isRoomSnapshot({ versionId: 'v1', planMarkdown: '# Plan', annotations: [] })).toBe(true);
  });

  test('accepts a snapshot with annotations', () => {
    expect(isRoomSnapshot({
      versionId: 'v1', planMarkdown: '# Plan', annotations: [GOOD_ANN],
    })).toBe(true);
  });

  test('rejects wrong versionId', () => {
    expect(isRoomSnapshot({ versionId: 'v2', planMarkdown: '', annotations: [] })).toBe(false);
    expect(isRoomSnapshot({ versionId: null, planMarkdown: '', annotations: [] })).toBe(false);
  });

  test('rejects non-string planMarkdown', () => {
    expect(isRoomSnapshot({ versionId: 'v1', planMarkdown: 42, annotations: [] })).toBe(false);
  });

  test('rejects non-array annotations', () => {
    expect(isRoomSnapshot({ versionId: 'v1', planMarkdown: '', annotations: 'not-array' })).toBe(false);
  });

  test('rejects if any annotation is malformed', () => {
    expect(isRoomSnapshot({
      versionId: 'v1', planMarkdown: '', annotations: [{ ...GOOD_ANN, type: null }],
    })).toBe(false);
  });

  test('rejects snapshot with unknown top-level keys', () => {
    expect(isRoomSnapshot({
      versionId: 'v1', planMarkdown: '', annotations: [], future: 'smuggled',
    })).toBe(false);
  });
});

describe('isPresenceState', () => {
  test('accepts minimal presence (null cursor)', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 'alice', color: '#f00' }, cursor: null,
    })).toBe(true);
  });

  test('accepts presence with cursor', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 'alice', color: '#f00' },
      cursor: { x: 1, y: 2, coordinateSpace: 'document' },
    })).toBe(true);
  });

  test('rejects non-string name', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 42, color: '#f00' }, cursor: null,
    })).toBe(false);
  });

  test('rejects payload missing required user field', () => {
    expect(isPresenceState({ cursor: null })).toBe(false);
  });

  test('rejects payload missing required cursor field (must be explicit, not absent)', () => {
    expect(isPresenceState({ user: { id: 'u', name: 'a', color: '#f00' } })).toBe(false);
  });

  test('rejects cursor without required fields', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 'a', color: '#f00' },
      cursor: { x: 1 },
    })).toBe(false);
  });

  test('rejects cursor with unknown coordinateSpace', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 'a', color: '#f00' },
      cursor: { x: 1, y: 2, coordinateSpace: 'galaxy' },
    })).toBe(false);
  });

  test('rejects non-finite cursor coordinates', () => {
    const base = { user: { id: 'u', name: 'a', color: '#f00' } };
    expect(isPresenceState({ ...base, cursor: { x: Infinity, y: 2, coordinateSpace: 'document' } })).toBe(false);
    expect(isPresenceState({ ...base, cursor: { x: -Infinity, y: 2, coordinateSpace: 'document' } })).toBe(false);
    expect(isPresenceState({ ...base, cursor: { x: NaN, y: 2, coordinateSpace: 'document' } })).toBe(false);
    expect(isPresenceState({ ...base, cursor: { x: 1, y: Infinity, coordinateSpace: 'document' } })).toBe(false);
    expect(isPresenceState({ ...base, cursor: { x: 1, y: NaN, coordinateSpace: 'document' } })).toBe(false);
  });

  test('rejects unknown top-level keys', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 'a', color: '#f00' },
      cursor: null,
      extra: 'smuggled',
    })).toBe(false);
  });

  test('rejects unknown keys on user', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 'a', color: '#f00', email: 'leak@example.com' },
      cursor: null,
    })).toBe(false);
  });

  test('rejects unknown keys on cursor', () => {
    expect(isPresenceState({
      user: { id: 'u', name: 'a', color: '#f00' },
      cursor: { x: 1, y: 2, coordinateSpace: 'document', z: 3 },
    })).toBe(false);
  });
});

describe('nested annotation meta — strict key allowlist', () => {
  test('rejects annotation meta with unknown keys', () => {
    expect(isRoomAnnotation({
      ...GOOD_ANN,
      startMeta: { parentTagName: 'p', parentIndex: 0, textOffset: 0, sneaky: true },
    })).toBe(false);
    expect(isRoomAnnotation({
      ...GOOD_ANN,
      endMeta: { parentTagName: 'p', parentIndex: 0, textOffset: 0, sneaky: true },
    })).toBe(false);
  });

  test('accepts annotation meta with exactly the allowlisted keys', () => {
    expect(isRoomAnnotation({
      ...GOOD_ANN,
      startMeta: { parentTagName: 'p', parentIndex: 0, textOffset: 3 },
      endMeta: { parentTagName: 'p', parentIndex: 0, textOffset: 8 },
    })).toBe(true);
  });
});
