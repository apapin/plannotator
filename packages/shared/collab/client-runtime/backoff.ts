/**
 * Exponential backoff with full jitter, used by auto-reconnect.
 *
 * Pure function — all timing/randomness injected so tests can stub.
 */

export interface BackoffOptions {
  initialDelayMs?: number;  // default 500
  maxDelayMs?: number;       // default 15_000
  factor?: number;           // default 2
}

export const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  initialDelayMs: 500,
  maxDelayMs: 15_000,
  factor: 2,
};

/**
 * Compute the delay (ms) before retry attempt N.
 *
 * Uses full jitter: `rand() * min(maxDelayMs, initialDelayMs * factor^attempt)`.
 * Attempt 0 is the first retry. Attempts are capped at the max delay.
 */
export function computeBackoffMs(
  attempt: number,
  options: BackoffOptions = {},
  rand: () => number = Math.random,
): number {
  const { initialDelayMs, maxDelayMs, factor } = { ...DEFAULT_BACKOFF, ...options };
  const rawDelay = initialDelayMs * Math.pow(factor, Math.max(0, attempt));
  const capped = Math.min(maxDelayMs, rawDelay);
  return Math.floor(rand() * capped);
}
