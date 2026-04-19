/**
 * Tiny typed event emitter for the collab room client runtime.
 *
 * Returns an unsubscribe function from `on()` for clean React useEffect teardown.
 * Wraps listener calls in try/catch so one throwing listener doesn't break others.
 */

export class TypedEventEmitter<M extends Record<string, unknown>> {
  private listeners: { [K in keyof M]?: Set<(payload: M[K]) => void> } = {};

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof M>(name: K, fn: (payload: M[K]) => void): () => void {
    let set = this.listeners[name];
    if (!set) {
      set = new Set();
      this.listeners[name] = set;
    }
    set.add(fn);
    return () => this.off(name, fn);
  }

  /** Remove a specific listener. */
  off<K extends keyof M>(name: K, fn: (payload: M[K]) => void): void {
    this.listeners[name]?.delete(fn);
  }

  /** Emit an event. Listener errors are isolated. */
  emit<K extends keyof M>(name: K, payload: M[K]): void {
    const set = this.listeners[name];
    if (!set) return;
    // Snapshot listeners BEFORE iterating so listeners added during emission
    // don't fire in the same pass (surprising semantics) and listeners
    // removed during emission don't throw the iterator.
    const snapshot = [...set];
    for (const fn of snapshot) {
      try {
        fn(payload);
      } catch (err) {
        // Isolate listener errors so one bad listener doesn't break others.
        // Log but don't re-throw.
        console.error(`[TypedEventEmitter] listener for "${String(name)}" threw:`, err);
      }
    }
  }

  /** Remove all listeners (useful for teardown). */
  removeAll(): void {
    this.listeners = {};
  }
}
