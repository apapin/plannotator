/**
 * Pure agent-identity helpers — shared between the `apps/collab-agent`
 * CLI and the room-side UI components that mark agent cursors /
 * avatars visually.
 *
 * Deliberately NOT placed alongside `identity.ts`. That file imports
 * `../config` (ConfigStore: cookie + server-sync), which must NOT
 * be pulled into the agent CLI's module graph. This file has zero
 * imports so both the browser UI and a plain Bun script can use it
 * without dragging browser storage or network code along.
 *
 * The identity convention is `<user>-agent-<type>`, where `<type>`
 * is one of the agent kinds below. Receivers (UI) use
 * `isAgentIdentity(name)` to decide whether to render the
 * distinguishing marker; senders (CLI) use `constructAgentIdentity`
 * to build the string from user + type inputs.
 */

/**
 * Canonical agent kinds Plannotator recognises. `other` is the
 * escape hatch — anything outside the known set still constructs a
 * valid identity (`foo-agent-other`) and is detected by
 * `isAgentIdentity`. New kinds get added here; detection expands
 * automatically via `KNOWN_AGENT_TYPES`.
 */
export const AGENT_TYPES = [
  'claude',
  'codex',
  'opencode',
  'junie',
  'other',
] as const;

export type AgentType = typeof AGENT_TYPES[number];

const KNOWN_AGENT_TYPES: ReadonlySet<string> = new Set(AGENT_TYPES);

/**
 * True when the name ends in `-agent-<known-type>`. The match is
 * case-sensitive: identities are lowercased by `constructAgentIdentity`
 * so a mixed-case name in the wild indicates either manual
 * construction (not through the CLI) or a human whose name happens
 * to include "Agent" as a word — we treat the latter as a false
 * positive worth avoiding.
 */
export function isAgentIdentity(name: string | undefined | null): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  const lastDash = name.lastIndexOf('-agent-');
  if (lastDash < 1) return false;
  const suffix = name.slice(lastDash + '-agent-'.length);
  return KNOWN_AGENT_TYPES.has(suffix);
}

/**
 * Extract the trailing type from an agent identity. Returns
 * undefined when the input isn't an agent identity — callers can
 * gate UI (tooltip, icon choice) on this.
 */
export function getAgentType(name: string | undefined | null): AgentType | undefined {
  if (typeof name !== 'string') return undefined;
  const lastDash = name.lastIndexOf('-agent-');
  if (lastDash < 1) return undefined;
  const suffix = name.slice(lastDash + '-agent-'.length);
  return KNOWN_AGENT_TYPES.has(suffix) ? (suffix as AgentType) : undefined;
}

export class InvalidAgentIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentIdentityError';
  }
}

/**
 * Normalize an arbitrary display name into a CLI-safe `--user` slug.
 *
 * `constructAgentIdentity` enforces a strict `/^[a-z0-9][a-z0-9-]*$/`
 * charset on the user half of the identity, but human display names
 * routinely carry spaces, uppercase, punctuation, and the occasional
 * emoji. This function bridges the two — feeding raw names through
 * slugification before they hit the agent CLI avoids either silent
 * shell truncation (unquoted `--user Michael Ramos` splits on the
 * space and drops "Ramos") or a thrown `InvalidAgentIdentityError`.
 *
 * Rules:
 *  - trim surrounding whitespace
 *  - lowercase
 *  - replace any run of non-`[a-z0-9-]` with a single `-`
 *  - collapse runs of `-`
 *  - strip leading/trailing `-`
 *  - if the result is empty (all-punctuation input), return `fallback`
 *
 * `fallback` exists so the slug is always a valid `--user` argument,
 * even when the display name can't produce one. Default is
 * `"participant"` to match the semantic level (a participant in a
 * room) without guessing at the user's intent.
 */
export function toAgentUserSlug(name: string, fallback = 'participant'): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug.length > 0 ? slug : fallback;
}

/**
 * Build `<user>-agent-<type>` from components. Normalizes to
 * lowercase so downstream hashing (presence color) is stable
 * across case variants. Rejects obviously malformed user inputs
 * with a descriptive error so CLI argv validation happens in one
 * place.
 *
 * `user` must match `/^[a-z0-9][a-z0-9-]*$/` (start with alnum,
 * then alnum/dashes). This is a superset of the tater-name
 * convention (`adjective-noun-tater`) so real agents identifying
 * for real users still validate.
 */
export function constructAgentIdentity(opts: {
  user: string;
  type: AgentType;
}): string {
  const user = opts.user.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(user)) {
    throw new InvalidAgentIdentityError(
      `user must start with alnum and contain only lowercase alnum/dashes; got "${opts.user}"`,
    );
  }
  if (!KNOWN_AGENT_TYPES.has(opts.type)) {
    throw new InvalidAgentIdentityError(
      `type must be one of ${AGENT_TYPES.join('|')}; got "${opts.type}"`,
    );
  }
  return `${user}-agent-${opts.type}`;
}
