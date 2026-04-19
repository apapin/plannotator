# @plannotator/collab-agent

Command-line tool that lets an AI agent join a Plannotator Live
Room as a first-class peer — read the plan, read annotations,
post comments, emit presence.

This is a human-readable README. Agent-facing prompt text lives
in [`AGENT_INSTRUCTIONS.md`](./AGENT_INSTRUCTIONS.md).

## Install

Everything is already wired as a workspace package. From the
repo root:

```sh
bun install
```

## Quick tour

The root `package.json` has a convenience script, but you can
also call the entry file directly.

```sh
# Help
bun run agent:run --help

# Read the plan (add --with-block-ids for block markers)
bun run agent:run read-plan \
  --url "http://localhost:8787/c/<roomId>#key=..." \
  --user alice --type claude

# Stay connected and stream events (Ctrl-C to exit)
bun run agent:run join \
  --url "..." --user alice --type claude

# Post a block-level comment
bun run agent:run comment \
  --url "..." --user alice --type claude \
  --block <blockId> \
  --text "Looks good, but consider section 3."

# List blocks without posting
bun run agent:run comment \
  --url "..." --user alice --type claude --list-blocks
```

## Identity

Agent identities follow the pattern `<user>-agent-<type>`.

- `--user` must match `/^[a-z0-9][a-z0-9-]*$/` — lowercase alnum
  with dashes. Case is normalized.
- `--type` is one of: `claude`, `codex`, `opencode`, `junie`,
  `other`.

The CLI assembles the full identity string. Peers see it as your
display name and in their avatar row. A small `⚙` marker makes
agent participants visually distinct from humans.

## Subcommands

| Subcommand | What it does |
|---|---|
| `join` | Connect, emit initial presence, heartbeat at 10s, stream room events to stdout until SIGINT. |
| `read-plan` | Print the decrypted plan markdown. `--with-block-ids` prefixes each block with `[block:<id>]`. |
| `read-annotations` | Print the current `RoomAnnotation[]` array as JSON. |
| `read-presence` | Print `remotePresence` (recent emitters, not a roster). `--settle <sec>` extends the wait (default 2s). |
| `comment` | Post a block-level COMMENT annotation. Requires `--block` + `--text`. `--list-blocks` prints available blocks and exits without posting. |
| `demo` | Walk heading blocks in order, anchor the cursor to each, leave a comment. `--duration <sec>`, `--comment-template <str>`, `--dry-run`. |

## Common flags

Every subcommand takes:

| Flag | Meaning |
|---|---|
| `--url <url>` | Full room URL including the `#key=<secret>` fragment. |
| `--user <name>` | Lowercase alnum + dashes. Forms the first half of the identity. |
| `--type <kind>` | `claude \| codex \| opencode \| junie \| other`. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | Runtime error — connect / snapshot / echo timeout, server rejection, unknown block id. |
| 2 | Argv or usage error — missing required flag, bad `--type`. |

## Admin URLs are stripped automatically

If the URL you pass contains `#admin=<secret>` (e.g. you copied
the creator's admin link instead of the participant link), the
CLI strips that fragment before connecting and prints a warning
to stderr. Agents never run as room admins in V1. There is no
opt-in flag.

## Running against a local dev room

To test end-to-end locally with both halves (a browser as
creator, an agent as participant):

```sh
# Terminal 1 — boot the full local stack (wrangler + editor)
bun run dev:live-room

# In the editor tab, click "Start Live Room" to get a URL.
# Copy the participant URL (not the admin URL — either works,
# but the CLI will strip admin for you).

# Terminal 2 — join as an agent
bun run agent:run join \
  --url "http://localhost:8787/c/<roomId>#key=..." \
  --user test --type claude
```

Observer watches the browser tab; the agent should appear in
the avatar row with the `⚙` marker and persist there for as
long as the `join` subcommand is running.

## Internals

The CLI is a thin layer over `CollabRoomClient` in
`packages/shared/collab/client-runtime/client.ts`. It reuses:

- `joinRoom()` factory (connect + key derivation + auth
  handshake).
- `parseMarkdownToBlocks()` (same markdown → block id derivation
  as the browser, so `--block` ids match what the observer
  renders).
- `PRESENCE_SWATCHES` / `hashNameToSwatch()` (identity ←→ color
  mapping; each agent identity maps deterministically to a
  distinct swatch).
- `isAgentIdentity()` + the agent-identity helpers
  (`packages/ui/utils/agentIdentity.ts` — a new pure module
  without ConfigStore / React deps, importable by both the CLI
  and the room UI components that render the `⚙` marker).

No new protocol; no server changes. Agents are first-class peers
in the existing V1 room protocol.
