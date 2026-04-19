import { describe, expect, test } from 'bun:test';
import { toRoomAnnotation, stripRoomAnnotationImages } from './strip-images';

describe('toRoomAnnotation', () => {
  test('strips images field', () => {
    const annotation = {
      id: 'ann-1',
      blockId: 'block-1',
      startOffset: 0,
      endOffset: 10,
      type: 'COMMENT' as const,
      text: 'a comment',
      originalText: 'some text',
      createdA: Date.now(),
      images: [{ path: '/tmp/image.png', name: 'screenshot' }],
    };

    const room = toRoomAnnotation(annotation);
    expect(room.id).toBe('ann-1');
    expect(room.text).toBe('a comment');
    expect(room.originalText).toBe('some text');
    expect('images' in room).toBe(false);
  });

  test('preserves all non-image fields', () => {
    const annotation = {
      id: 'ann-2',
      blockId: 'block-2',
      startOffset: 5,
      endOffset: 15,
      type: 'DELETION' as const,
      originalText: 'deleted text',
      createdA: 1234567890,
      author: 'swift-falcon-tater',
      source: 'eslint',
      isQuickLabel: true,
      diffContext: 'added' as const,
      images: [{ path: '/tmp/a.png', name: 'a' }],
    };

    const room = toRoomAnnotation(annotation);
    expect(room.author).toBe('swift-falcon-tater');
    expect(room.source).toBe('eslint');
    expect(room.isQuickLabel).toBe(true);
    expect(room.diffContext).toBe('added');
  });

  test('works on annotation without images', () => {
    const annotation = {
      id: 'ann-3',
      blockId: 'block-3',
      startOffset: 0,
      endOffset: 5,
      type: 'GLOBAL_COMMENT' as const,
      text: 'global note',
      originalText: '',
      createdA: Date.now(),
    };

    const room = toRoomAnnotation(annotation);
    expect(room.id).toBe('ann-3');
    expect(room.text).toBe('global note');
    expect('images' in room).toBe(false);
  });

  test('serialized output has no images key', () => {
    const annotation = {
      id: 'ann-4',
      type: 'COMMENT' as const,
      images: [{ path: '/tmp/x.png', name: 'x' }],
    };
    const room = toRoomAnnotation(annotation);
    const json = JSON.stringify(room);
    expect(json).not.toContain('images');
  });
});

// Batch conversion (`toRoomAnnotations`) is module-private; it's
// exercised transitively through `stripRoomAnnotationImages` below.

describe('stripRoomAnnotationImages', () => {
  test('returns clean annotations with images removed', () => {
    const annotations = [
      { id: '1', type: 'COMMENT' as const, images: [{ path: '/a', name: 'a' }] },
      { id: '2', type: 'DELETION' as const },
    ];
    const { clean, strippedCount } = stripRoomAnnotationImages(annotations);
    expect(clean.length).toBe(2);
    for (const a of clean) expect('images' in a).toBe(false);
    expect(strippedCount).toBe(1);
  });

  test('counts only annotations with non-empty images arrays', () => {
    const annotations = [
      { id: '1', images: [{ path: '/a', name: 'a' }] },               // counts
      { id: '2', images: [{ path: '/b', name: 'b' }, { path: '/c', name: 'c' }] }, // counts
      { id: '3', images: [] },                                         // does NOT count (empty)
      { id: '4' },                                                     // does NOT count (undefined)
    ];
    const { strippedCount } = stripRoomAnnotationImages(annotations);
    expect(strippedCount).toBe(2);
  });

  test('returns 0 count for empty input', () => {
    const { clean, strippedCount } = stripRoomAnnotationImages([]);
    expect(clean).toEqual([]);
    expect(strippedCount).toBe(0);
  });

  test('returns 0 count when no annotations carry images', () => {
    const annotations = [
      { id: '1', type: 'COMMENT' as const },
      { id: '2', type: 'DELETION' as const, images: undefined },
    ];
    const { strippedCount } = stripRoomAnnotationImages(annotations);
    expect(strippedCount).toBe(0);
  });

  test('strippedCount includes globalAttachments length', () => {
    const annotations = [
      { id: '1', type: 'COMMENT' as const, images: [{ path: '/a', name: 'a' }] },
      { id: '2', type: 'DELETION' as const },
    ];
    const globals = [
      { path: '/g1', name: 'g1' },
      { path: '/g2', name: 'g2' },
    ];
    const { clean, strippedCount } = stripRoomAnnotationImages(annotations, globals);
    // 1 image-bearing annotation + 2 globals = 3 items not traveling.
    expect(strippedCount).toBe(3);
    // clean still only reflects annotation shape, no globals merged in.
    expect(clean.length).toBe(2);
  });

  test('omitting globalAttachments defaults to 0 (back-compat with callers)', () => {
    const annotations = [
      { id: '1', type: 'COMMENT' as const, images: [{ path: '/a', name: 'a' }] },
    ];
    const { strippedCount } = stripRoomAnnotationImages(annotations);
    expect(strippedCount).toBe(1);
  });
});
