import { act } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useRoomAnnotationController } from './useAnnotationController';
import { AnnotationType, type Annotation } from '../types';
import type { UseCollabRoomReturn } from './collab/useCollabRoom';
import type { RoomAnnotation } from '@plannotator/shared/collab';

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

/**
 * Build a UseCollabRoomReturn stub. Tests control `annotations`, `seq`, and
 * `roomStatus` via mutator functions, then rerender with the same room
 * reference — the controller reads via getters so mutations land in the
 * next render without rebuilding the stub.
 */
function mockRoom(initial: {
  annotations?: RoomAnnotation[];
  roomStatus?: UseCollabRoomReturn['roomStatus'];
  seq?: number;
}): {
  room: UseCollabRoomReturn;
  setAnnotations(next: RoomAnnotation[]): void;
  setRoomStatus(next: UseCollabRoomReturn['roomStatus']): void;
  setSeq(next: number): void;
  /** Advance room state: new annotations + new seq in one mutation. */
  advance(next: RoomAnnotation[], seqDelta?: number): void;
  /** Raise a new server-side error (simulates room.error wire message). */
  emitError(
    code: string,
    message: string,
    scope?: 'mutation' | 'admin' | 'event' | 'presence' | 'snapshot' | 'join',
  ): void;
  calls: { method: string; args: unknown[] }[];
  makeSendFail(shouldFail: boolean): void;
} {
  let annotations = initial.annotations ?? [];
  let roomStatus = initial.roomStatus ?? 'active';
  let seq = initial.seq ?? 0;
  let lastError: { code: string; message: string; scope: 'mutation' | 'admin' | 'event' | 'presence' | 'snapshot' | 'join' } | null = null;
  let lastErrorId = 0;
  let shouldFail = false;
  const calls: { method: string; args: unknown[] }[] = [];

  const record = (method: string, args: unknown[]) => {
    calls.push({ method, args });
  };
  const maybeFail = async (method: string, args: unknown[]) => {
    record(method, args);
    if (shouldFail) throw new Error(`simulated failure for ${method}`);
  };

  const makeReturn = (): UseCollabRoomReturn => ({
    connectionStatus: 'authenticated',
    get roomStatus() { return roomStatus; },
    planMarkdown: '',
    get annotations() { return annotations; },
    get seq() { return seq; },
    remotePresence: {},
    hasAdminCapability: false,
    get lastError() { return lastError; },
    get lastErrorId() { return lastErrorId; },
    addAnnotations: async (a) => maybeFail('addAnnotations', [a]),
    updateAnnotation: async (id, patch) => maybeFail('updateAnnotation', [id, patch]),
    removeAnnotations: async (ids) => maybeFail('removeAnnotations', [ids]),
    clearAnnotations: async (src) => maybeFail('clearAnnotations', [src]),
    updatePresence: async () => {},
    lock: async () => {},
    unlock: async () => {},
    deleteRoom: async () => {},
    client: null,
  });

  return {
    room: makeReturn(),
    setAnnotations: (next) => { annotations = next; },
    setRoomStatus: (next) => { roomStatus = next; },
    setSeq: (next) => { seq = next; },
    advance: (next, delta = 1) => { annotations = next; seq += delta; },
    emitError: (code, message, scope = 'mutation') => {
      lastError = { code, message, scope };
      lastErrorId++;
    },
    calls,
    makeSendFail: (v) => { shouldFail = v; },
  };
}

describe('useRoomAnnotationController', () => {
  test('mode is "room" and isLocked reflects room status', () => {
    const m = mockRoom({ roomStatus: 'active' });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );
    expect(result.current.mode).toBe('room');
    expect(result.current.isLocked).toBe(false);

    m.setRoomStatus('locked');
    rerender({ room: m.room });
    expect(result.current.isLocked).toBe(true);
  });

  test('add() marks pending + populates pendingAdditions; NOT annotations, NOT echoed yet', async () => {
    const m = mockRoom({ seq: 0 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    const ann = makeAnn('a1');
    await act(async () => {
      result.current.add(ann);
    });
    // Canonical annotations stay server-only — V1 server-authoritative.
    expect(result.current.annotations.some(a => a.id === 'a1')).toBe(false);
    // Optimistic row is surfaced via pendingAdditions for panel rendering.
    expect(result.current.pendingAdditions.has('a1')).toBe(true);
    expect(result.current.pending.get('a1')?.kind).toBe('add');
    expect(m.calls.some(c => c.method === 'addAnnotations')).toBe(true);

    // Server applies — seq advances and id appears in room.annotations.
    m.advance([toRoomAnnotation(ann)]);
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('a1')).toBe(false);
    // Optimistic buffer dropped; canonical list now holds the echo.
    expect(result.current.annotations.filter(a => a.id === 'a1').length).toBe(1);
    expect(result.current.pendingAdditions.has('a1')).toBe(false);
  });

  test('add pending does NOT clear on an unrelated seq advance', async () => {
    // An unrelated peer's op advances seq while our add is still in flight.
    // Canonical annotations get a different id from the peer; our id still
    // hasn't echoed. Pending MUST stay set so the optimistic row keeps its
    // "Sending…" chrome instead of silently demoting to a normal row.
    const m = mockRoom({ seq: 5 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    const mine = makeAnn('mine');
    await act(async () => { result.current.add(mine); });
    expect(result.current.pending.has('mine')).toBe(true);

    // Peer's op bumps seq and adds their annotation — our id is absent.
    const theirs = makeAnn('theirs');
    m.advance([toRoomAnnotation(theirs)]);
    await act(async () => { rerender({ room: m.room }); });

    expect(result.current.pending.get('mine')?.kind).toBe('add');
    expect(result.current.pendingAdditions.has('mine')).toBe(true);
  });

  test('server-side rejection (room.error) moves in-flight pending to failed', async () => {
    // Transport promise resolves on SEND, so sendOp doesn't reject when
    // the server later rejects the op. The controller must observe
    // room.lastError to transition pending → failed, otherwise the row
    // would sit as "Sending…" forever.
    const m = mockRoom({ seq: 1 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    await act(async () => { result.current.add(makeAnn('locked-add')); });
    expect(result.current.pending.has('locked-add')).toBe(true);

    m.emitError('room_locked', 'Room is locked');
    await act(async () => { rerender({ room: m.room }); });

    expect(result.current.pending.has('locked-add')).toBe(false);
    const failure = result.current.failed.get('locked-add');
    expect(failure?.kind).toBe('add');
    expect(failure?.error).toContain('room_locked');
    // Row remains in pendingAdditions so Retry/Discard can render.
    expect(result.current.pendingAdditions.has('locked-add')).toBe(true);
  });

  test('server-side rejection also catches update and remove', async () => {
    const a = makeAnn('u-edit', { text: 'before' });
    const b = makeAnn('u-rm');
    const m = mockRoom({
      annotations: [toRoomAnnotation(a), toRoomAnnotation(b)],
      seq: 2,
    });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    await act(async () => {
      result.current.update('u-edit', { text: 'after' });
      result.current.remove('u-rm');
    });
    expect(result.current.pending.size).toBe(2);

    m.emitError('validation_error', 'bad payload');
    await act(async () => { rerender({ room: m.room }); });

    expect(result.current.pending.size).toBe(0);
    expect(result.current.failed.has('u-edit')).toBe(true);
    expect(result.current.failed.has('u-rm')).toBe(true);
  });

  test('non-mutation error scopes (presence/snapshot/event/join) do NOT fail pending ops', async () => {
    // A peer's malformed presence frame or a local snapshot decode
    // failure is not a rejection of OUR sends. Only server-sent
    // 'mutation'-scoped errors must move pending → failed.
    const m = mockRoom({ seq: 3 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );
    await act(async () => { result.current.add(makeAnn('still-pending')); });
    expect(result.current.pending.has('still-pending')).toBe(true);

    m.emitError('presence_malformed', 'peer bad presence', 'presence');
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('still-pending')).toBe(true);
    expect(result.current.failed.has('still-pending')).toBe(false);

    m.emitError('event_decrypt_failed', 'peer event failed', 'event');
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('still-pending')).toBe(true);

    m.emitError('snapshot_malformed', 'bad snapshot', 'snapshot');
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('still-pending')).toBe(true);
  });

  test('admin-scoped errors do NOT trip mutation pending → failed', async () => {
    // A failed lock/unlock/delete (admin scope) must not mark racing
    // annotation sends as failed. The controller filters by scope.
    const m = mockRoom({ seq: 1 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );
    await act(async () => { result.current.add(makeAnn('ann-safe')); });
    expect(result.current.pending.has('ann-safe')).toBe(true);

    m.emitError('lock_failed', 'admin lock rejected', 'admin');
    await act(async () => { rerender({ room: m.room }); });

    // Pending should STAY pending — admin error didn't reject the add.
    expect(result.current.pending.has('ann-safe')).toBe(true);
    expect(result.current.failed.has('ann-safe')).toBe(false);
  });

  test('a single error is processed exactly once (dedup by lastErrorId)', async () => {
    // Simulate the CollabRoomClient re-emitting state with a cloned
    // lastError object: the object identity changes every render but
    // lastErrorId does not. The controller must not double-process.
    const m = mockRoom({ seq: 2 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    const first = makeAnn('first-add');
    await act(async () => { result.current.add(first); });

    m.emitError('room_locked', 'locked', 'mutation');
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.failed.has('first-add')).toBe(true);

    // Another add races through AFTER the first rejection. The new one
    // must not be swept into the same failed bucket just because
    // lastError is still non-null.
    await act(async () => { result.current.add(makeAnn('second-add')); });
    // Simulate a state re-emission with the SAME error (clone, same id).
    // `emitError` without a new call keeps lastErrorId stable; we just
    // force a rerender.
    await act(async () => { rerender({ room: m.room }); });

    expect(result.current.pending.has('second-add')).toBe(true);
    expect(result.current.failed.has('second-add')).toBe(false);
  });

  test('failed add keeps pendingAdditions row so Retry/Discard render', async () => {
    const m = mockRoom({});
    m.makeSendFail(true);
    const { result } = renderHook(() => useRoomAnnotationController(m.room));

    await act(async () => {
      result.current.add(makeAnn('failed-add'));
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.current.failed.has('failed-add')).toBe(true);
    // Failed row lives in pendingAdditions (panel-only), NOT in annotations.
    expect(result.current.annotations.some(a => a.id === 'failed-add')).toBe(false);
    expect(result.current.pendingAdditions.has('failed-add')).toBe(true);

    await act(async () => { result.current.discard!('failed-add'); });
    expect(result.current.pendingAdditions.has('failed-add')).toBe(false);
  });

  test('update() pending clears once seq advances past send (regardless of patch match)', async () => {
    // Reconciliation uses seq-advance as the sole clear trigger. Gating on
    // "echo reflects our patch" would leave pending stuck forever when
    // another user's concurrent write supersedes ours — not the UX we want.
    const ann = makeAnn('u1', { text: 'before' });
    const m = mockRoom({ annotations: [toRoomAnnotation(ann)], seq: 10 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    await act(async () => {
      result.current.update('u1', { text: 'after' });
    });
    expect(result.current.pending.get('u1')?.kind).toBe('update');

    // Seq does not advance — pending stays.
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('u1')).toBe(true);

    // Seq advances with the post-patch value — pending clears.
    m.advance([toRoomAnnotation({ ...ann, text: 'after' })]);
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('u1')).toBe(false);
  });

  test('update() pending also clears when seq advances but value was superseded', async () => {
    const ann = makeAnn('u2', { text: 'before' });
    const m = mockRoom({ annotations: [toRoomAnnotation(ann)], seq: 10 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    await act(async () => { result.current.update('u2', { text: 'mine' }); });

    // Server admits another op (seq advances) whose echoed value is
    // `theirs` — NOT our patch. Pending must still clear: the server has
    // moved past our send and the UI correctly shows the winning value.
    m.advance([toRoomAnnotation({ ...ann, text: 'theirs' })]);
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('u2')).toBe(false);
  });

  test('remove() pending clears when seq advances and id is absent', async () => {
    const ann = makeAnn('r1');
    const m = mockRoom({ annotations: [toRoomAnnotation(ann)], seq: 5 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    await act(async () => {
      result.current.remove('r1');
    });
    expect(result.current.pending.get('r1')?.kind).toBe('remove');

    // Server processes the remove — seq advances, id gone.
    m.advance([]);
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('r1')).toBe(false);
  });

  test('remove() pending stays when seq has NOT advanced even if id is absent', async () => {
    // Edge case: removing an id that is already absent from the server snapshot.
    const m = mockRoom({ annotations: [], seq: 3 });
    const { result, rerender } = renderHook(
      ({ room }) => useRoomAnnotationController(room),
      { initialProps: { room: m.room } },
    );

    await act(async () => { result.current.remove('already-gone'); });
    expect(result.current.pending.has('already-gone')).toBe(true);

    // No seq advance yet → pending must not prematurely clear.
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('already-gone')).toBe(true);

    // Now seq advances. Even though id was never in the snapshot, we
    // consider the server to have processed the remove (idempotent).
    m.setSeq(4);
    await act(async () => { rerender({ room: m.room }); });
    expect(result.current.pending.has('already-gone')).toBe(false);
  });

  test('failed send moves id from pending to failed with kind + error', async () => {
    const m = mockRoom({});
    m.makeSendFail(true);
    const { result } = renderHook(() => useRoomAnnotationController(m.room));

    await act(async () => {
      result.current.add(makeAnn('f1'));
      await new Promise(r => setTimeout(r, 10));
    });

    expect(result.current.pending.has('f1')).toBe(false);
    const fail = result.current.failed.get('f1');
    expect(fail?.kind).toBe('add');
    expect(fail?.error).toContain('simulated failure');
  });

  test('retry resends a previously-failed op', async () => {
    const m = mockRoom({});
    m.makeSendFail(true);
    const { result } = renderHook(() => useRoomAnnotationController(m.room));

    await act(async () => {
      result.current.add(makeAnn('r2'));
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.current.failed.has('r2')).toBe(true);

    m.makeSendFail(false);
    await act(async () => {
      result.current.retry!('r2');
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.current.failed.has('r2')).toBe(false);
    expect(result.current.pending.has('r2')).toBe(true);
    expect(m.calls.filter(c => c.method === 'addAnnotations').length).toBe(2);
  });

  test('discard drops a failed id without resending', async () => {
    const m = mockRoom({});
    m.makeSendFail(true);
    const { result } = renderHook(() => useRoomAnnotationController(m.room));

    await act(async () => {
      result.current.add(makeAnn('d1'));
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.current.failed.has('d1')).toBe(true);

    await act(async () => result.current.discard!('d1'));
    expect(result.current.failed.has('d1')).toBe(false);
  });

  test('setAll is undefined in room mode', () => {
    const m = mockRoom({});
    const { result } = renderHook(() => useRoomAnnotationController(m.room));
    expect(result.current.setAll).toBeUndefined();
  });

  test('strips images field when sending', async () => {
    const m = mockRoom({});
    const { result } = renderHook(() => useRoomAnnotationController(m.room));

    const annWithImages = makeAnn('img1', {
      images: [{ path: '/tmp/x.png', name: 'x' }],
    });
    await act(async () => {
      result.current.add(annWithImages);
    });

    const addCall = m.calls.find(c => c.method === 'addAnnotations');
    expect(addCall).toBeDefined();
    const [sent] = addCall!.args as [RoomAnnotation[]];
    expect(sent[0].id).toBe('img1');
    expect('images' in sent[0]).toBe(false);
  });
});

function toRoomAnnotation(a: Annotation): RoomAnnotation {
  const { images: _images, ...rest } = a;
  return rest as RoomAnnotation;
}
