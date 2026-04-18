import { describe, expect, test } from 'bun:test';
import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  test('serializes null', () => {
    expect(canonicalJson(null)).toBe('null');
  });

  test('serializes booleans', () => {
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
  });

  test('serializes numbers', () => {
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson(-3.14)).toBe('-3.14');
    expect(canonicalJson(0)).toBe('0');
  });

  test('serializes strings', () => {
    expect(canonicalJson('hello')).toBe('"hello"');
    expect(canonicalJson('')).toBe('""');
    expect(canonicalJson('has "quotes"')).toBe('"has \\"quotes\\""');
  });

  test('serializes arrays preserving order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
  });

  test('sorts object keys lexicographically', () => {
    expect(canonicalJson({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  test('sorts nested object keys at every level', () => {
    const input = { b: { d: 1, c: 2 }, a: { f: 3, e: 4 } };
    expect(canonicalJson(input)).toBe('{"a":{"e":4,"f":3},"b":{"c":2,"d":1}}');
  });

  test('omits undefined fields', () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  test('handles undefined as top-level value', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });

  test('produces no whitespace', () => {
    const result = canonicalJson({ key: [1, { nested: true }] });
    expect(result).not.toContain(' ');
    expect(result).not.toContain('\n');
    expect(result).not.toContain('\t');
  });

  test('throws on NaN', () => {
    expect(() => canonicalJson(NaN)).toThrow('not serializable');
  });

  test('throws on Infinity', () => {
    expect(() => canonicalJson(Infinity)).toThrow('not serializable');
    expect(() => canonicalJson(-Infinity)).toThrow('not serializable');
  });

  test('throws on functions', () => {
    expect(() => canonicalJson(() => {})).toThrow('not serializable');
  });

  test('throws on symbols', () => {
    expect(() => canonicalJson(Symbol('test'))).toThrow('not serializable');
  });

  test('throws on bigint', () => {
    expect(() => canonicalJson(BigInt(42))).toThrow('not serializable');
  });

  // Known-output test vectors — security-critical stability tests
  describe('test vectors', () => {
    test('AdminCommand room.lock', () => {
      expect(canonicalJson({ type: 'room.lock' })).toBe('{"type":"room.lock"}');
    });

    test('AdminCommand room.lock with snapshot', () => {
      expect(canonicalJson({ type: 'room.lock', finalSnapshotCiphertext: 'abc' }))
        .toBe('{"finalSnapshotCiphertext":"abc","type":"room.lock"}');
    });

    test('AdminCommand room.unlock', () => {
      expect(canonicalJson({ type: 'room.unlock' })).toBe('{"type":"room.unlock"}');
    });

    test('AdminCommand room.delete', () => {
      expect(canonicalJson({ type: 'room.delete' })).toBe('{"type":"room.delete"}');
    });

    test('same input always produces same output', () => {
      const input = { type: 'room.lock', finalSnapshotCiphertext: 'data' };
      const first = canonicalJson(input);
      const second = canonicalJson(input);
      const third = canonicalJson({ finalSnapshotCiphertext: 'data', type: 'room.lock' });
      expect(first).toBe(second);
      expect(first).toBe(third);
    });
  });
});
