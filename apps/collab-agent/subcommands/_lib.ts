/**
 * Shared helpers for the agent subcommands: argv parsing of the
 * common `--url`/`--user`/`--type` shape, connect + identity
 * construction, and a one-shot cleanup-on-signal wiring.
 *
 * Each subcommand file owns its own top-level flow; this lib just
 * dedupes the boilerplate that would otherwise repeat four times.
 */

import {
  joinRoom,
  type CollabRoomClient,
} from '@plannotator/shared/collab/client';
import type { PresenceState } from '@plannotator/shared/collab';
import { hashNameToSwatch } from '@plannotator/ui/utils/presenceColor';
import {
  constructAgentIdentity,
  isAgentType,
  stripAdminFragment,
  AGENT_TYPES,
  type AgentType,
} from '../identity';

export interface CommonArgs {
  url: string;
  user: string;
  type: AgentType;
  /** Raw argv slice AFTER the subcommand name, for subcommand-specific flags. */
  rest: string[];
}

/**
 * Parse `--url`, `--user`, `--type` plus anything else. Throws a
 * `UsageError` (caught by the dispatcher) on any missing or
 * malformed required flag so error messages land in one place.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function parseCommonArgs(argv: readonly string[]): CommonArgs {
  const flags = new Map<string, string>();
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags.set(key, 'true');
      } else {
        flags.set(key, next);
        i++;
      }
    } else {
      rest.push(token);
    }
  }

  const url = flags.get('url');
  const user = flags.get('user');
  const type = flags.get('type');

  if (!url) throw new UsageError('Missing --url');
  if (!user) throw new UsageError('Missing --user');
  if (!type) throw new UsageError(`Missing --type (one of ${AGENT_TYPES.join('|')})`);
  if (!isAgentType(type)) {
    throw new UsageError(`--type must be one of ${AGENT_TYPES.join('|')}; got "${type}"`);
  }

  // Consume the common flags from the flags-turned-rest reconstruction so
  // subcommand-specific args can be read from `rest` as a plain
  // --flag value stream. Simpler: re-emit the non-common flags.
  const consumed = new Set(['url', 'user', 'type']);
  const passthrough: string[] = [];
  for (const [k, v] of flags) {
    if (consumed.has(k)) continue;
    passthrough.push(`--${k}`);
    if (v !== 'true') passthrough.push(v);
  }

  return { url, user, type, rest: [...passthrough, ...rest] };
}

/**
 * Read a string flag from an already-parsed `rest` stream. Returns
 * undefined when absent. Throws UsageError when the flag is present
 * but has no value (i.e. immediately followed by another `--flag`).
 */
export function readStringFlag(rest: readonly string[], name: string): string | undefined {
  const idx = rest.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  const next = rest[idx + 1];
  if (next === undefined || next.startsWith('--')) {
    throw new UsageError(`--${name} requires a value`);
  }
  return next;
}

export function readBoolFlag(rest: readonly string[], name: string): boolean {
  return rest.includes(`--${name}`);
}

export function readNumberFlag(rest: readonly string[], name: string): number | undefined {
  const raw = readStringFlag(rest, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new UsageError(`--${name} must be a number; got "${raw}"`);
  }
  return n;
}

export interface AgentSession {
  client: CollabRoomClient;
  identity: string;
  color: string;
  /** Ready-to-send initial presence (null cursor). */
  initialPresence: PresenceState;
}

/**
 * Strip `#admin=` (warning to stderr), construct the agent identity,
 * derive the identity-based color, connect via `joinRoom`, and return
 * a session bag. Does NOT emit initial presence — callers choose
 * whether to emit once (one-shot subcommands) or emit + heartbeat
 * (`join` / `demo`).
 */
export async function openAgentSession(args: CommonArgs): Promise<AgentSession> {
  const { url: rawUrl, stripped } = stripAdminFragment(args.url);
  if (stripped) {
    console.warn(
      '[collab-agent] URL contained #admin=; stripped. ' +
        'Agents do not run in admin mode in V1.',
    );
  }

  const identity = constructAgentIdentity({ user: args.user, type: args.type });
  const color = hashNameToSwatch(identity);

  const client = await joinRoom({
    url: rawUrl,
    user: { id: identity, name: identity, color },
    autoConnect: true,
  });

  const initialPresence: PresenceState = {
    user: { id: identity, name: identity, color },
    cursor: null,
  };

  return { client, identity, color, initialPresence };
}

/**
 * Wait for a `snapshot` event (full initial snapshot delivered by
 * the server after auth). After this resolves, `client.getState()`
 * has planMarkdown + annotations populated. Times out at
 * `timeoutMs` (default 10s) so a malformed room doesn't hang
 * read-* subcommands forever.
 */
export function awaitInitialSnapshot(
  client: CollabRoomClient,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const state = client.getState();
    // Snapshot may already be present if joinRoom completed the
    // handshake before we subscribed (race window is small but real).
    if (state.planMarkdown.length > 0 || state.annotations.length > 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Timed out waiting for snapshot after ${timeoutMs}ms`));
    }, timeoutMs);
    const off = client.on('snapshot', () => {
      clearTimeout(timer);
      off();
      resolve();
    });
  });
}

/**
 * Wire SIGINT + SIGTERM to a graceful `client.disconnect()`. Returns
 * a function that removes the handlers — call it after disconnect
 * completes in the non-signal path so we don't accumulate listeners
 * across subcommand invocations in the same process.
 */
export function wireSignalShutdown(client: CollabRoomClient): () => void {
  const onSignal = () => {
    try {
      client.disconnect('user_interrupt');
    } catch {
      // disconnect is idempotent; swallow double-call errors
    }
    // Give the socket a beat to send a close frame before we exit.
    setTimeout(() => process.exit(0), 100);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
}
