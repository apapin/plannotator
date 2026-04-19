/**
 * Heartbeat presence manager for the agent CLI.
 *
 * The room protocol has no roster / join broadcast; peers appear in
 * avatar rows + cursor layers only when presence is received.
 * The client-runtime sweep removes presence entries older than
 * `PRESENCE_TTL_MS` (30s) from the receiver's view of a peer.
 *
 * An agent that goes quiet (post a comment, wait for a reply) would
 * therefore vanish from observers after ~30s. Human users refresh
 * presence through mousemove; an agent has no such ambient signal.
 * The heartbeat solves this by re-sending the last-known presence
 * on a 10s cadence (~3× headroom under the TTL) whenever the CLI
 * holds a live connection.
 *
 * Usage:
 *
 *   const heartbeat = startHeartbeat(client, presence);
 *   // ... do agent work, periodically call heartbeat.update(nextPresence)
 *   heartbeat.stop();
 *
 * The manager swallows send errors (presence is lossy by design;
 * reconnects handle cross-session state rebuild). It silently no-ops
 * when the client is not in the `authenticated` state so tear-down
 * windows don't spam the socket.
 *
 * Interval coupling: `HEARTBEAT_INTERVAL_MS` must stay well below
 * `PRESENCE_TTL_MS` in the client runtime (currently 30s). If that
 * constant ever tightens, this interval needs to tighten too.
 */

import type { CollabRoomClient } from '@plannotator/shared/collab/client';
import type { PresenceState } from '@plannotator/shared/collab';

export const HEARTBEAT_INTERVAL_MS = 10_000;

export interface HeartbeatHandle {
  /** Replace the presence payload that will be re-sent on each tick. */
  update(next: PresenceState): void;
  /** Stop the heartbeat. Safe to call multiple times. */
  stop(): void;
}

/**
 * Start a heartbeat that re-sends the given presence every
 * `HEARTBEAT_INTERVAL_MS`. Does NOT send an initial presence —
 * callers are expected to `await client.sendPresence(initial)`
 * once themselves before starting the heartbeat so peers see the
 * agent appear immediately, not only after the first heartbeat tick.
 */
export function startHeartbeat(
  client: CollabRoomClient,
  initialPresence: PresenceState,
): HeartbeatHandle {
  let current = initialPresence;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    // Only tick when authenticated. The client's sendPresence will
    // no-op on non-authenticated sockets, but checking here avoids
    // console noise during reconnect windows.
    const state = client.getState();
    if (state.connectionStatus !== 'authenticated') return;
    void client.sendPresence(current).catch(() => {
      // Presence is lossy by protocol contract; drop failures.
    });
  }, HEARTBEAT_INTERVAL_MS);

  return {
    update(next: PresenceState) {
      current = next;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}
