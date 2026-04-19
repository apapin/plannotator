import { describe, expect, test, mock } from 'bun:test';
import { TypedEventEmitter } from './emitter';

interface Events {
  foo: number;
  bar: { message: string };
}

describe('TypedEventEmitter', () => {
  test('emits to subscribed listeners', () => {
    const e = new TypedEventEmitter<Events>();
    const fn = mock(() => {});
    e.on('foo', fn);
    e.emit('foo', 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  test('unsubscribe function removes listener', () => {
    const e = new TypedEventEmitter<Events>();
    const fn = mock(() => {});
    const unsub = e.on('foo', fn);
    e.emit('foo', 1);
    unsub();
    e.emit('foo', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('off removes a specific listener', () => {
    const e = new TypedEventEmitter<Events>();
    const fn1 = mock(() => {});
    const fn2 = mock(() => {});
    e.on('foo', fn1);
    e.on('foo', fn2);
    e.off('foo', fn1);
    e.emit('foo', 1);
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  test('isolates listener errors', () => {
    const e = new TypedEventEmitter<Events>();
    const fn1 = mock(() => { throw new Error('boom'); });
    const fn2 = mock(() => {});
    e.on('foo', fn1);
    e.on('foo', fn2);
    // Should not throw
    e.emit('foo', 1);
    expect(fn2).toHaveBeenCalled();
  });

  test('removeAll clears listeners', () => {
    const e = new TypedEventEmitter<Events>();
    const fn = mock(() => {});
    e.on('foo', fn);
    e.removeAll();
    e.emit('foo', 1);
    expect(fn).not.toHaveBeenCalled();
  });

  test('emitting with no listeners is safe', () => {
    const e = new TypedEventEmitter<Events>();
    // Should not throw
    e.emit('foo', 1);
  });

  test('supports multiple event types', () => {
    const e = new TypedEventEmitter<Events>();
    const fooFn = mock(() => {});
    const barFn = mock(() => {});
    e.on('foo', fooFn);
    e.on('bar', barFn);
    e.emit('foo', 1);
    e.emit('bar', { message: 'hi' });
    expect(fooFn).toHaveBeenCalledWith(1);
    expect(barFn).toHaveBeenCalledWith({ message: 'hi' });
  });
});
