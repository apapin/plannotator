import { describe, expect, test } from 'bun:test';
import { computeBackoffMs, DEFAULT_BACKOFF } from './backoff';

describe('computeBackoffMs', () => {
  // Stable random for deterministic tests
  const rand05 = () => 0.5;
  const rand0 = () => 0;
  const rand1 = () => 0.999999;

  test('attempt 0 uses initial delay (with jitter)', () => {
    expect(computeBackoffMs(0, {}, rand05)).toBe(Math.floor(0.5 * DEFAULT_BACKOFF.initialDelayMs));
  });

  test('attempt 1 doubles (factor 2)', () => {
    expect(computeBackoffMs(1, {}, rand05)).toBe(Math.floor(0.5 * DEFAULT_BACKOFF.initialDelayMs * 2));
  });

  test('delay caps at maxDelayMs', () => {
    // Attempt 20 would be 500 * 2^20 = 524,288,000 — capped at 15_000
    expect(computeBackoffMs(20, {}, rand1)).toBe(Math.floor(0.999999 * 15_000));
  });

  test('rand=0 produces 0 delay', () => {
    expect(computeBackoffMs(5, {}, rand0)).toBe(0);
  });

  test('custom options override defaults', () => {
    const opts = { initialDelayMs: 100, maxDelayMs: 1000, factor: 3 };
    expect(computeBackoffMs(0, opts, rand05)).toBe(Math.floor(0.5 * 100));
    expect(computeBackoffMs(1, opts, rand05)).toBe(Math.floor(0.5 * 300));
    expect(computeBackoffMs(5, opts, rand1)).toBe(Math.floor(0.999999 * 1000));
  });

  test('negative attempt treated as 0', () => {
    expect(computeBackoffMs(-5, {}, rand05)).toBe(Math.floor(0.5 * DEFAULT_BACKOFF.initialDelayMs));
  });
});
