import { describe, expect, test } from 'bun:test';
import { toRoomAnnotation, toRoomAnnotations } from './strip-images';

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

describe('toRoomAnnotations', () => {
  test('batch strips images from all annotations', () => {
    const annotations = [
      { id: '1', type: 'COMMENT' as const, images: [{ path: '/a', name: 'a' }] },
      { id: '2', type: 'DELETION' as const },
      { id: '3', type: 'COMMENT' as const, images: [{ path: '/b', name: 'b' }] },
    ];

    const rooms = toRoomAnnotations(annotations);
    expect(rooms.length).toBe(3);
    for (const r of rooms) {
      expect('images' in r).toBe(false);
    }
    expect(rooms[0].id).toBe('1');
    expect(rooms[1].id).toBe('2');
    expect(rooms[2].id).toBe('3');
  });
});
