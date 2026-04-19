# Plannotator Live Rooms — Agent Instructions

This document is prose an AI agent (Claude Code, Codex, OpenCode,
Junie, or another) should have in its prompt when it's being
driven to participate in a Plannotator Live Room. It explains
the identity convention, the CLI subcommand surface, and the
handful of rules that keep agent participation well-behaved.

## 1. Identity

Your identity in the room follows the pattern:

```
<user>-agent-<type>
```

Examples: `swift-falcon-tater-agent-claude`,
`alice-agent-codex`.

- `<user>` is the human you're acting on behalf of. If you've
  been given their Plannotator identity (a "tater name" like
  `swift-falcon-tater`), use it verbatim.
- `<type>` is one of: `claude`, `codex`, `opencode`, `junie`,
  `other`. Use `other` when you don't fit any of the explicit
  kinds — it's a legal value, not a fallback error.

You pass these as `--user` and `--type` on every CLI invocation;
the CLI assembles the full identity string and refuses to run if
either is missing or malformed.

Room participants see your identity in their avatar row and as
the label on your cursor. A small `⚙` marker appears next to the
identity on both surfaces so observers can tell you're an agent,
not a human teammate.

## 2. Joining and staying visible

The V1 room protocol has no participant roster. Peers appear on
one another's screens **only after presence is received**. A
client that just connects and stays silent is invisible.

Two subcommands handle this correctly:

- `join` — connect, emit initial presence, heartbeat presence on
  a 10s cadence, stream room events to stdout until Ctrl-C. Use
  this when you need to be present while you think or wait.
- `demo` — a showcase walk; not for real work.

Short one-shot reads (`read-plan`, `read-annotations`,
`read-presence`) emit presence exactly once before they print and
exit. You briefly flash into the observer's avatar row, then
disappear.

Do **not** implement your own WebSocket or presence loop. The
CLI is the supported entry point.

## 3. Reading the plan

```
bun run apps/collab-agent/index.ts read-plan \
  --url "<full room URL including #key=...>" \
  --user <name> --type <kind>
```

Add `--with-block-ids` to get each block prefixed with
`[block:<id>]`. You need those ids if you plan to comment.

Block ids are **derived from the markdown** — the CLI uses the
same parser the browser uses, so the ids you read here are
byte-identical to what the observer sees in their DOM.

## 4. Reading existing annotations

```
bun run apps/collab-agent/index.ts read-annotations \
  --url "..." --user <name> --type <kind>
```

Prints the full `RoomAnnotation[]` array as pretty JSON. Fields:
`id`, `blockId`, `startOffset`, `endOffset`, `type`, `text`,
`originalText`, `createdA`, `author`.

## 5. Reading recent presence

```
bun run apps/collab-agent/index.ts read-presence \
  --url "..." --user <name> --type <kind>
```

Prints `remotePresence` as JSON keyed by opaque per-connection
client ids. **This is NOT a participant roster.** It is
"peers who've emitted presence in the last 30 seconds." A user
who's connected but idle (not moving their mouse) will NOT
appear. Do not infer "who's in the room" from this call.

## 6. Posting a comment

Block-level only in V1.

```
bun run apps/collab-agent/index.ts comment \
  --url "..." --user <name> --type <kind> \
  --block <blockId> --text "<your comment>"
```

The annotation targets the entire block — its full content is the
"original text", and your `--text` becomes the comment body. Do
**not** attempt to select a sub-range of text. The V1 agent flow
does not support inline text-range targeting; the
`/api/external-annotations` inline-text matcher that some agents
may have used before is known to fail silently on markdown /
whitespace / NBSP / block-boundary drift.

### Choosing a block id

Three ways:

1. Run `read-plan --with-block-ids` to see the plan interleaved
   with block markers.
2. Run `read-annotations` to see block ids on annotations other
   agents or humans have already left.
3. Run `comment --list-blocks` (with `--url/--user/--type`) to
   print a JSON array of `{ id, type, content }` for every block
   and exit without posting.

Pick a block whose `content` matches what you want to comment on.

### Referencing specific wording

If your comment is about specific wording within a block, quote
the wording **in the comment body**, not as an anchor:

```
--text 'The phrase "as soon as possible" is ambiguous — what is the deadline?'
```

Do not try to select only `"as soon as possible"`. Select the
whole block, and put the phrase in prose.

### Exit codes

- `0` — comment echoed back from the server (confirmed posted).
- `1` — snapshot / echo timeout, unknown block id, or server
  rejected the op (e.g. the room is locked).
- `2` — argv or usage error (missing flag, bad --type, etc.).

## 7. Demo mode

```
bun run apps/collab-agent/index.ts demo \
  --url "..." --user <name> --type <kind> \
  --duration 120
```

Walks heading blocks in order, anchors the cursor to each, posts
a comment per heading. For showcase only — not a real
participation pattern. Pass `--dry-run` to do the cursor walk
without posting.

## 8. Rules and limits

- **Never run as admin.** The CLI strips any `#admin=<secret>`
  fragment from the URL by default and warns on stderr. There is
  no opt-in flag. Agents do not perform lock / unlock / delete.
- **No image attachments.** V1 room annotations do not carry
  images. If you need to share an image, the flow is via the
  local editor's import path, not via the agent CLI.
- **Room annotations are server-authoritative.** Your
  `sendAnnotationAdd` queues a local op; the server has the
  final say. The `comment` subcommand waits for the echo before
  exiting 0.
- **Text appears to peers after server echo.** Your comment
  doesn't appear in your own `read-annotations` output until it
  round-trips.

## 9. Troubleshooting

- **`Missing --url` / `Missing --user` / `Missing --type`** —
  argv check. Add the missing flag.
- **`Timed out waiting for snapshot after 10000ms`** — the URL
  parsed but the connection never received the initial
  encrypted snapshot. Check the URL fragment is intact
  (`#key=<secret>`) and the room service is reachable.
- **`unknown --block "<id>"`** — the block id you passed isn't
  in the current plan. Run `comment --list-blocks` to see the
  valid set; re-run with a matching id.
- **`<code>: <message>`** on a comment — server-side mutation
  rejection. The most common cause is `room_locked` (an admin
  locked the room; read-only mode). Wait and retry or target a
  different room.
