/**
 * `join` subcommand — connect to the room, emit an initial presence
 * payload, start a 10 s heartbeat, and stream interesting events to
 * stdout until the process receives SIGINT.
 *
 * Heartbeat is what keeps the agent visible on observers while it's
 * idle. Without it, the V1 protocol has no participant roster; the
 * observer's 30 s presence TTL would sweep us away.
 */

import { startHeartbeat } from '../heartbeat';
import {
  awaitInitialSnapshot,
  openAgentSession,
  parseCommonArgs,
  wireSignalShutdown,
  type CommonArgs,
} from './_lib';

export async function runJoin(argv: readonly string[]): Promise<number> {
  const args = parseCommonArgs(argv);
  return runJoinWithArgs(args);
}

async function runJoinWithArgs(args: CommonArgs): Promise<number> {
  const session = await openAgentSession(args);
  const { client, identity } = session;

  const unwireSignals = wireSignalShutdown(client);

  try {
    await awaitInitialSnapshot(client);
  } catch (err) {
    console.error(`[collab-agent] ${(err as Error).message}`);
    client.disconnect('snapshot_timeout');
    unwireSignals();
    return 1;
  }

  // Announce ourselves visually. `sendPresence` is lossy but the
  // initial emit is worth surfacing if it fails — that signals a
  // protocol or key-derivation issue the user should know about.
  await client.sendPresence(session.initialPresence);

  const heartbeat = startHeartbeat(client, session.initialPresence);

  const state = client.getState();
  console.log(
    JSON.stringify({
      event: 'joined',
      identity,
      roomId: state.roomId,
      clientId: state.clientId,
      planBytes: state.planMarkdown.length,
      annotationCount: state.annotations.length,
    }),
  );

  // Stream events to stdout so an invoking agent can react. Keep it
  // light — only events a consumer plausibly cares about. Each line
  // is a complete JSON object (NDJSON), easy to parse line-by-line.
  client.on('event', (serverEvent) => {
    console.log(JSON.stringify({ event: 'room.event', data: serverEvent }));
  });
  client.on('presence', (entry) => {
    // Suppress our own echoed presence (never broadcast by server,
    // but belt-and-braces against future protocol changes).
    if (entry.clientId === client.getState().clientId) return;
    console.log(
      JSON.stringify({
        event: 'room.presence',
        clientId: entry.clientId,
        user: entry.presence.user,
        cursor: entry.presence.cursor,
      }),
    );
  });
  client.on('room-status', (status) => {
    console.log(JSON.stringify({ event: 'room.status', status }));
    if (status === 'deleted' || status === 'expired') {
      heartbeat.stop();
      client.disconnect('terminal_status');
      unwireSignals();
      process.exit(0);
    }
  });
  client.on('error', (err) => {
    console.error(JSON.stringify({ event: 'room.error', ...err }));
  });

  // Keep the event loop alive. The socket + heartbeat timer already
  // hold refs, but an extra long-lived timer is cheap belt-and-braces
  // against runtimes that would otherwise exit early.
  setInterval(() => {}, 1 << 30);

  // Never resolves under normal operation — signal handlers exit.
  return await new Promise<number>(() => {});
}
