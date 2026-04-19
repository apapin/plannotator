/**
 * Agent identity + URL sanitisation helpers for the CLI. The pure
 * construction/detection helpers live in
 * `@plannotator/ui/utils/agentIdentity` — this file layers on
 * CLI-specific concerns:
 *
 *   - parsing `--user` / `--type` argv into a validated agent
 *     identity string;
 *   - stripping `#admin=<secret>` out of a room URL so an agent
 *     never accidentally runs with admin capability even if the
 *     user pastes a creator-side admin link.
 *
 * The admin-URL guard is a hard default in V1. There is no
 * `--as-admin` opt-in; agents are never admins. Adding that
 * surface area without a concrete use case is footgun creation
 * (per the plan's risk note).
 */

import {
  constructAgentIdentity,
  InvalidAgentIdentityError,
  type AgentType,
  AGENT_TYPES,
} from '@plannotator/ui/utils/agentIdentity';

export { constructAgentIdentity, InvalidAgentIdentityError, AGENT_TYPES };
export type { AgentType };

/** True when the supplied string is a recognised agent type. */
export function isAgentType(value: string): value is AgentType {
  return (AGENT_TYPES as readonly string[]).includes(value);
}

/**
 * Result of `stripAdminFragment`. `stripped` indicates whether an
 * `admin=…` param was actually present and removed — callers use
 * this to print the CLI warning exactly once per run.
 */
export interface StripAdminFragmentResult {
  url: string;
  stripped: boolean;
}

/**
 * Remove `admin=<secret>` from a room URL's fragment while
 * preserving `key=…` and anything else. Returns the input
 * unchanged when no fragment or no admin param is present.
 *
 * Implementation note: room URL fragments are parsed as
 * `URLSearchParams` strings by the client (see `parseRoomUrl`
 * in `packages/shared/collab/url.ts`), so this function follows
 * the same shape — split on `#`, treat the right half as a
 * URLSearchParams, delete `admin`, rebuild.
 */
export function stripAdminFragment(rawUrl: string): StripAdminFragmentResult {
  const hashIdx = rawUrl.indexOf('#');
  if (hashIdx < 0) return { url: rawUrl, stripped: false };

  const base = rawUrl.slice(0, hashIdx);
  const fragment = rawUrl.slice(hashIdx + 1);
  const params = new URLSearchParams(fragment);
  if (!params.has('admin')) return { url: rawUrl, stripped: false };

  params.delete('admin');
  const rebuilt = params.toString();
  return {
    url: rebuilt ? `${base}#${rebuilt}` : base,
    stripped: true,
  };
}
