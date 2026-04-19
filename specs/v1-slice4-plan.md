# Slice 4: Browser/Direct-Agent Collab Client Runtime

## Context

Slices 1-3 built the protocol contract, the room service, and the durable room engine. The `apps/room-service/scripts/smoke.ts` file (390 lines) is the inline reference client — it implements every client behavior using direct WebSocket and crypto calls. Slice 4 refactors those patterns into a reusable `CollabRoomClient` runtime and a React hook, so browsers and direct-agent clients can connect to room.plannotator.ai without duplicating protocol code.

Slice 4 does NOT wire into `packages/editor/App.tsx`, add share UI, cursor overlays, approve/deny, or the local SSE bridge. Those are Slice 5 and Slice 6.

## File Structure

Create a new subdirectory under `packages/shared/collab/`:

```
packages/shared/collab/client-runtime/
  types.ts               — runtime state + options types
  emitter.ts             — TypedEventEmitter (tiny local, ~40 lines)
  backoff.ts             — pure computeBackoffMs() for reconnect
  apply-event.ts         — pure reducer applying RoomServerEvent to annotations Map
  client.ts              — CollabRoomClient class (core, ~400 lines)
  create-room.ts         — createRoom() HTTP helper
  join-room.ts           — joinRoom() factory
  mock-websocket.ts      — in-memory WebSocket for unit tests

  emitter.test.ts
  backoff.test.ts
  apply-event.test.ts
  client.test.ts         — uses mock-websocket
  integration.test.ts    — gated by SMOKE_BASE_URL (against wrangler dev)
```

Export from the **client barrel only** (`@plannotator/shared/collab/client`). The Worker/DO must never import from client-runtime.

Extend `packages/shared/collab/url.ts` to parse the `admin=` fragment param and add `buildAdminRoomUrl()`.

Add `packages/ui/hooks/useCollabRoom.ts` as the React wrapper.

## Key Design Decisions

**Class with factory wrappers.** `CollabRoomClient` is a class (long-lived state, many methods). `createRoom()` and `joinRoom()` are factory functions that construct instances. Clients can call `new CollabRoomClient()` directly if needed; typical callers use the factories.

**Tiny local TypedEventEmitter.** ~40 lines, no dependency. API: `on(name, fn) → unsubscribe`, `off`, `emit`, `removeAll`. Wraps listeners in try/catch so one throwing listener doesn't break others. Avoids `EventTarget` (poor typing, silently swallows errors) and external packages (supply-chain and bundle cost not worth it for 40 lines).

**Internal state: `Map<id, RoomAnnotation>`.** Fast O(1) updates and lookups. Derive an ordered `RoomAnnotation[]` for consumers via `[...map.values()]`. Map insertion order is stable per spec.

**Auto-reconnect with exponential backoff + jitter.** `initialDelayMs = 500`, `maxDelayMs = 15_000`, `factor = 2`. Full jitter: `Math.min(max, initial * factor^attempt) * Math.random()`. Reset attempt counter on successful `auth.accepted`. On terminal close (room deleted/expired), transition to `'closed'` and stop. Reconnect sends current `this.seq` as `lastSeq` so the server replays missed events.

**Server echo is authoritative (no optimistic apply in V1).** On `sendAnnotationAdd(...)`: generate `opId`, encrypt, send over wire. Do NOT apply to local state. The server broadcasts the op back via `room.event` to ALL clients including the sender; `handleRoomEvent` processes it and advances `this.seq`. Valid events are applied through `applyAnnotationEvent`; malformed or undecryptable events are consumed for forward progress but do not mutate state. There is no echo dedup. Rationale: V1 has no opId-correlated ack/reject, so optimistic apply has no safe rollback path if the server rejects the op (e.g., room transitions to locked between local check and DO processing). Mutation methods resolve when the send completes, not when state updates — consumers subscribe to the `state` event for post-echo state.

**Accepted V1 UX tradeoff: slight latency for accepted-state correctness.** The original Slice 4 direction considered optimistic local apply: the sender would see an annotation immediately, then reconcile with the server echo. V1 intentionally does not do this. A user-created annotation appears only after the room service receives it, assigns a durable `seq`, and echoes it back. On healthy networks this should feel near-instant, but slow or unstable connections may show a brief delay between submit and visible annotation.

We accept that delay because V1 has no op-specific `ack` / `reject` message and no rollback protocol. If the client applied locally and the server later rejected the op (for example because the room locked between the local status check and DO processing), the sender could see an annotation that no other participant sees. That is more confusing than a small delay. V1 therefore prefers one consistent, server-accepted view over instant local feedback. Product UI should show lightweight pending feedback around annotation submission and surface `room.error` clearly, especially `room_locked`. If later UX requires instant-feeling annotations, add protocol support first: `opId`-correlated `ack` / `reject`, or explicit client-side pending annotations with rollback.

**Admin command resolution via observed effects.** The server doesn't send `admin.command.ok` — effects are observed via `room.status` broadcast (lock/unlock) or socket close (delete). The client resolves/rejects admin promises based on observable outcomes, not on send:
- `lockRoom()` resolves when the next `room.status: locked` arrives for this client.
- `unlockRoom()` resolves when the next `room.status: active` arrives (from locked).
- `deleteRoom()` resolves only when `room.status: deleted` is broadcast OR the socket closes with the server's successful-delete signature (`WS_CLOSE_ROOM_UNAVAILABLE` + reason `"Room deleted"`). Other close codes/reasons (network drop, `"Room delete failed"`) reject with `AdminInterruptedError` — we must not report success when the delete was interrupted or failed.
- ALL admin promises reject on: `room.error` received while pending (server rejected proof/state/seq), non-deletion socket close while pending, or 5s timeout with no observable effect.

This prevents the class of bug where a caller thinks a lock succeeded when the server actually rejected it for invalid proof/state/seq.

**Presence uses `presenceKey`, not `eventKey`.** The smoke.ts reference incorrectly uses `eventKey` for both channels — the DO is zero-knowledge so it doesn't notice. The protocol spec derives a distinct `presenceKey` via HKDF with label `plannotator:v1:presence`. The runtime must use the correct key per channel. Unit test: presence ciphertext encrypted with presenceKey must NOT decrypt with eventKey.

**`clientId` is regenerated per connection.** Every `connect()` call generates a fresh `clientId` via `generateClientId()` (random per socket). On reconnect, a new `clientId` is minted — reusing one across reconnects would turn server-visible metadata into a longer-lived participant identifier. Stable identity across reconnects lives inside encrypted `PresenceState.user.id`, which the DO never sees.

**Stale presence cleanup.** Because `clientId` rotates per connection and the server sends no "presence leave" events, stale cursors can accumulate when peers disconnect or reconnect. The runtime tracks `lastSeen: number` alongside each remote presence entry and runs a periodic sweep (every 5s) that removes entries where `Date.now() - lastSeen > PRESENCE_TTL_MS` (default 30s — longer than the typical presence heartbeat interval but short enough to feel fresh). On any `room.presence` message, update `lastSeen` for the sender's clientId. On socket close, clear all remote presence.

**Connect timeout and auth handshake cleanup.** `connect()` has a default 10-second timeout from `new WebSocket(...)` to `auth.accepted`. If the timeout fires: close the socket with code 1000 (normal), reject the `connect()` promise with `ConnectTimeoutError`, transition status to `disconnected` (not `reconnecting` — timeouts during initial connect don't auto-retry; reconnect applies only to established sessions that drop). If the server closes during the handshake (before `auth.accepted`) with any code, reject `connect()` with `AuthRejectedError` and transition to `disconnected`. Both paths clear any pending timers to avoid leaks.

## Public API

### Types (from `client-runtime/types.ts`)

```ts
export type ConnectionStatus =
  | 'disconnected' | 'connecting' | 'authenticating'
  | 'authenticated' | 'reconnecting' | 'closed';

export interface CollabRoomUser { id: string; name: string; color: string; }

export interface CollabRoomState {
  connectionStatus: ConnectionStatus;
  roomStatus: RoomStatus | null;
  roomId: string;
  clientId: string;                 // random per connection
  seq: number;                      // last server seq consumed by this client (used as reconnect lastSeq)
  planMarkdown: string;
  annotations: RoomAnnotation[];    // ordered view of internal Map
  remotePresence: Record<string, PresenceState>; // keyed by clientId
  hasAdminCapability: boolean;
  lastError: { code: string; message: string } | null;
}

export interface CollabRoomEvents {
  status: ConnectionStatus;
  'room-status': RoomStatus;
  snapshot: RoomSnapshot;
  event: RoomServerEvent;
  presence: { clientId: string; presence: PresenceState };
  error: { code: string; message: string };
  state: CollabRoomState;  // fires on any state mutation; React hook subscribes here
}
```

### `createRoom()`

```ts
export interface CreateRoomOptions {
  baseUrl: string;  // e.g. https://room.plannotator.ai or http://localhost:8787
  initialSnapshot: RoomSnapshot;
  expiresInDays?: number;
  user: CollabRoomUser;
  webSocketImpl?: typeof WebSocket;  // test injection
  fetchImpl?: typeof fetch;          // test injection
}

export interface CreateRoomResult {
  roomId: string;
  roomSecret: Uint8Array;
  adminSecret: Uint8Array;
  joinUrl: string;   // with #key=<roomSecret>
  adminUrl: string;  // with #key=<roomSecret>&admin=<adminSecret>
  client: CollabRoomClient;  // constructed but NOT connected; caller calls client.connect()
}

export async function createRoom(options: CreateRoomOptions): Promise<CreateRoomResult>;
```

Flow: generate roomId + secrets → derive keys → compute verifiers → encrypt initial snapshot → POST `/api/rooms` → build URLs → construct client with pre-seeded snapshot state. Does NOT call `connect()` — caller controls connection timing.

### `joinRoom()`

```ts
export interface JoinRoomOptions {
  url: string;                              // full room URL including fragment
  adminSecret?: Uint8Array | string;        // override if not in URL fragment
  user: CollabRoomUser;
  webSocketImpl?: typeof WebSocket;
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number; factor?: number; maxAttempts?: number };
  autoConnect?: boolean;                    // default false
}

export async function joinRoom(options: JoinRoomOptions): Promise<CollabRoomClient>;
```

Flow: parse URL via `parseRoomUrl()` → derive keys → construct client. If `autoConnect: true`, awaits `connect()` before returning.

### `CollabRoomClient`

```ts
export class CollabRoomClient {
  // Lifecycle
  // connect(): resolves on auth.accepted; rejects on timeout (10s default) or server close.
  // If called after disconnect() or after reaching a terminal state, connect() first
  // clears userDisconnected and lastError and resets reconnectAttempt, then opens a new socket.
  connect(): Promise<void>;
  disconnect(reason?: string): void;  // user-initiated; disables reconnect until next connect()

  // Subscription
  on<K extends keyof CollabRoomEvents>(
    name: K,
    fn: (p: CollabRoomEvents[K]) => void,
  ): () => void;                       // returns unsubscribe

  // State read
  getState(): CollabRoomState;         // immutable snapshot

  // Mutations (send-ack only; local state updates after server echo via the `state` event)
  sendAnnotationAdd(annotations: RoomAnnotation[]): Promise<void>;
  sendAnnotationUpdate(id: string, patch: Partial<RoomAnnotation>): Promise<void>;
  sendAnnotationRemove(ids: string[]): Promise<void>;
  sendAnnotationClear(source?: string): Promise<void>;
  sendPresence(presence: PresenceState): Promise<void>;

  // Admin (reject if no admin capability)
  // lockRoom: if finalSnapshot provided, client encrypts with eventKey and
  // sets finalSnapshotAtSeq to this.seq at command time. Admin proof binds to
  // both the ciphertext and atSeq via canonicalJson(command).
  lockRoom(options?: { finalSnapshot?: RoomSnapshot }): Promise<void>;
  unlockRoom(): Promise<void>;
  deleteRoom(): Promise<void>;
}
```

### `useCollabRoom` React hook

```ts
export interface UseCollabRoomOptions {
  url: string;
  adminSecret?: string;               // base64url; hook does NOT persist it
  user: CollabRoomUser;
  enabled?: boolean;                  // default true
}

export interface UseCollabRoomReturn {
  connectionStatus: ConnectionStatus;
  roomStatus: RoomStatus | null;
  planMarkdown: string;
  annotations: RoomAnnotation[];
  remotePresence: Record<string, PresenceState>;
  hasAdminCapability: boolean;
  lastError: { code: string; message: string } | null;

  addAnnotations: (a: RoomAnnotation[]) => Promise<void>;
  updateAnnotation: (id: string, patch: Partial<RoomAnnotation>) => Promise<void>;
  removeAnnotations: (ids: string[]) => Promise<void>;
  clearAnnotations: (source?: string) => Promise<void>;
  updatePresence: (p: PresenceState) => Promise<void>;

  lock: (opts?: { finalSnapshot?: RoomSnapshot }) => Promise<void>;
  unlock: () => Promise<void>;
  deleteRoom: () => Promise<void>;

  client: CollabRoomClient | null;   // escape hatch
}
```

Implementation pattern (matches `useExternalAnnotations`):
- `useEffect(() => { ... }, [url, adminSecret, user.id, enabled])`: parse URL, call `joinRoom()`, ref the client, call `connect()`. On dep change, the effect tears down and re-creates the client. Full dep list ensures stale clients don't linger when admin capability is added/removed or user identity changes.
- Document the stability contract: consumers should memoize `user` (it's used by value; unstable `user` props will thrash reconnects). The hook uses `user.id` as the primary dep key; changes to `user.name`/`user.color` propagate to the next `sendPresence()` call without reconnecting.
- Subscribe to `state` event → update a `useState<CollabRoomState>`.
- Mutation methods are `useCallback`-memoized and delegate to the client.
- On unmount: unsubscribe, `client.disconnect()`.
- If `enabled === false` or the client has not finished setup: skip the connect effect and return the `DISCONNECTED_STATE` snapshot. Mutation and admin methods **throw/reject with a clear unavailable-client error**, they are **not** silent no-ops. Silent no-ops would let a user click "Add annotation" or "Lock room" and see nothing happen, with no indication that the action was lost. Throwing forces the UI (in Slice 5) to either disable the button while the room isn't ready, or surface a user-visible error. The current implementation uses a `requireClient()` helper that throws `"Collab room client is not available (disabled or not yet connected)"` — consumers should rely on this contract.

## URL Extensions (`packages/shared/collab/url.ts`)

Extend `ParsedRoomUrl`:
```ts
export interface ParsedRoomUrl {
  roomId: string;
  roomSecret: Uint8Array;
  adminSecret?: Uint8Array;  // NEW — from &admin=... in fragment
}
```

`parseRoomUrl()` also reads `admin=` param. Validates `adminSecret` decodes to exactly 32 bytes (matches `generateAdminSecret()` output); rejects the whole URL if `admin=` is present but malformed.

Add `buildAdminRoomUrl(roomId, roomSecret, adminSecret, baseUrl?)` that produces `.../c/<roomId>#key=<roomSecret>&admin=<adminSecret>`. Validates `adminSecret.length === 32`.

Matches spec v1.md:72 (admin recovery URL format).

**Default sharing stays admin-free.** The copied join URL produced by `createRoom().joinUrl` and `buildRoomJoinUrl()` contains ONLY `#key=<roomSecret>`. `buildAdminRoomUrl()` / `adminUrl` are creator-only recovery outputs that must not be the default copy target. The hook and editor must never surface `adminUrl` as the share button's text — admin capability is sensitive and stays with the creator.

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/collab/url.ts` | Extend ParsedRoomUrl with `adminSecret?`; add `buildAdminRoomUrl` |
| `packages/shared/collab/client.ts` | Add client-runtime exports |
| `packages/shared/collab/url.test.ts` | Add tests for admin fragment parse + build |

## Files to Create

All in `packages/shared/collab/client-runtime/`:
- `types.ts`, `emitter.ts`, `backoff.ts`, `apply-event.ts`
- `client.ts`, `create-room.ts`, `join-room.ts`, `mock-websocket.ts`
- `emitter.test.ts`, `backoff.test.ts`, `apply-event.test.ts`, `client.test.ts`, `integration.test.ts`

And:
- `packages/ui/hooks/useCollabRoom.ts`

## Implementation Order

1. **Primitives with tests:** `emitter.ts`, `backoff.ts`, `apply-event.ts` (pure, zero internal deps)
2. **`types.ts`** (pure types, no runtime)
3. **`url.ts` extension** + tests (admin fragment parsing, `buildAdminRoomUrl`)
4. **`mock-websocket.ts`** (test harness)
5. **`client.ts`** (the class) + `client.test.ts` (written together, test-driven)
6. **`create-room.ts`** and **`join-room.ts`** (thin wrappers)
7. **`client.ts` barrel re-exports** (client barrel only)
8. **`useCollabRoom.ts`** in `packages/ui/hooks/`
9. **`integration.test.ts`** — gated by `SMOKE_BASE_URL` env var

## Reconnect Semantics

- `onclose` → if `userDisconnected`: status `closed`, stop.
- If terminal (room deleted/expired detected via room.status before close, OR close code 4006 with recognizable reason): status `closed`, emit `error`, stop.
- Otherwise: status `reconnecting`, compute backoff delay, setTimeout → internal reconnect attempt (new WebSocket with existing keys). Send current `this.seq` as `lastSeq`.
- On reconnect success: reset `reconnectAttempt = 0`.
- Local `annotations` map preserved across reconnects; server replay reconciles.
- `remotePresence` cleared on close (others will re-broadcast presence post-reconnect).
- **Explicit `connect()` resets lifecycle flags.** A manual `disconnect()` sets `userDisconnected = true`, which prevents auto-reconnect on socket close. A subsequent explicit `connect()` call must clear `userDisconnected`, clear any terminal `lastError`, and reset `reconnectAttempt` to 0 before opening a new socket. Without this, manual disconnect would poison later manual reconnects and silently suppress auto-reconnect behavior.

## Send and Apply (V1)

When sending an op:
1. Generate `opId = generateOpId()`.
2. Encrypt the op with `eventKey`.
3. Send the envelope over the WebSocket.
4. Return. No local state mutation — the server echo is authoritative.

When receiving a `room.event`:
1. Decrypt and shape-validate the op (`isRoomEventClientOp` — event-channel validator; rejects `presence.update`, which must not land in the durable log).
2. Apply via `apply-event.ts` when valid.
3. Advance `this.seq = event.seq`. This happens on the valid path AND the malformed / undecryptable paths — `this.seq` means "last server seq consumed by this client," not "last applied." Forward-progress is required so reconnect does not replay the same bad event forever and block every event behind it.
4. Emit `event` and `state` on the valid path; emit `event_malformed` / `event_decrypt_failed` on the rejection paths (state unchanged).

`opId` is still generated and sent over the wire for protocol/logging symmetry and to enable future opId-correlated ack/reject, but V1 does not maintain a client-side cache of sent opIds. There is no echo dedup — every valid event (including our own echoes) is processed exactly once through the single server-authoritative path.

## Admin Flow

**V1 assumption: single creator-held admin capability.** The normal participant share URL is `#key=...` only. The `#key=...&admin=...` URL is a sensitive creator/recovery URL and is not intentionally shared with participants. Because admin capability is effectively single-holder in V1, it's acceptable for the client to resolve admin commands by observing `room.status` transitions (`locked`, `active`, `deleted`) rather than command-specific acks. This is NOT multi-admin-safe — if two admin-capable clients are connected simultaneously, a `room.status: locked` broadcast would resolve both their pending lock promises even though only one command was actually executed. Multi-admin support would require a protocol change: add `commandId` to `AdminCommandEnvelope` and an `admin.result { commandId, ok, error? }` ack from the room service. Deferred post-V1.

Per-command, since admin challenges are single-use and don't persist:

1. Assert `adminKey !== null`. Otherwise reject with `AdminNotAuthorizedError`.
2. Assert `pendingAdmin === null` (one in-flight per client).
3. Send `{ type: 'admin.challenge.request' }`.
4. Return a Promise; store `{ resolve, reject, command, sentAt, timeoutHandle }` in `pendingAdmin`. **Keep the promise open — do NOT resolve on send.**
5. On receiving `admin.challenge`: compute `computeAdminProof()`, send `admin.command` envelope with proof. Promise stays pending.
6. On receiving `room.status: locked` (for lock command) or `room.status: active` (for unlock from locked) → **resolve** the pending promise, clear `pendingAdmin`.
7. On receiving `room.status: deleted` OR the successful-delete socket close (`WS_CLOSE_ROOM_UNAVAILABLE` + reason `"Room deleted"`) for delete command → **resolve** the pending promise.
8. On receiving `room.error` while pending → **reject** with `AdminRejectedError(error.code, error.message)`, clear `pendingAdmin`.
9. On socket close while pending for non-delete commands, failed delete closes, or network drops → reject with `AdminInterruptedError`, clear `pendingAdmin`.
10. On 5s timeout with no observable effect → reject with `AdminTimeoutError`, clear `pendingAdmin`.
11. Do NOT auto-retry admin commands after reconnect. They're user-initiated.

## Error Types

```ts
export class ConnectTimeoutError extends Error {}
export class AuthRejectedError extends Error {}
export class RoomUnavailableError extends Error {}  // close 4006
export class NotConnectedError extends Error {}
export class AdminNotAuthorizedError extends Error {}
export class AdminTimeoutError extends Error {}
export class AdminInterruptedError extends Error {}
export class AdminRejectedError extends Error { constructor(public code: string, message: string) { super(message); } }
export class InvalidRoomUrlError extends Error {}
export class CreateRoomError extends Error { status: number; }
```

## Testing Strategy

### Unit tests (mock WebSocket)
- Connect → auth.challenge → auth.response → auth.accepted transitions
- Snapshot decrypt + annotation Map population
- `sendAnnotationAdd` produces correctly-encrypted envelope; local state does not change until the server echo; own echoes and peer events apply through the same server-authoritative path
- Reconnect: simulate close, assert backoff timing with stubbed Math.random and fake timers; assert `lastSeq` in new auth.response
- Admin lock: triggers challenge.request → responds with correctly-bound proof
- Admin lock with `finalSnapshot`: client encrypts with eventKey, sets `finalSnapshotAtSeq = this.seq`, proof binds to both ciphertext and atSeq via canonicalJson(command)
- Admin promise resolution via observed effects: `lockRoom()` pending → server sends `room.status: locked` → promise resolves; server sends `room.error` instead → promise rejects with `AdminRejectedError`
- No admin capability: `lockRoom()` rejects synchronously
- `disconnect()` sets userDisconnected; subsequent close does not reconnect
- Terminal close (4006) → `closed` without reconnect
- `presenceKey` vs `eventKey`: presence ciphertext MUST NOT decrypt with eventKey

### Pure reducer tests (`apply-event.test.ts`)
- Snapshot replaces annotations Map
- Add/update/remove semantics
- Clear with and without source filter
- Missing-id update is no-op (with log)

### Integration test (`integration.test.ts`, gated)
- Skipped unless `SMOKE_BASE_URL` is set
- Full round-trip against `wrangler dev`: createRoom → two clients join → event exchange → presence relay → reconnect replay → admin lock/unlock/delete
- Uses `CollabRoomClient` (no inline WebSocket)

### React hook test — deferred to Slice 5

The workspace does not currently depend on `@testing-library/react`, `happy-dom`, or `jsdom`. Running React hook tests requires a DOM test environment (to mount a component that calls the hook) plus a render helper. Adding one of these as a dev dependency is a non-trivial workspace change that belongs with the Slice 5 editor integration work, where hook behavior is exercised live against the real editor UI.

For Slice 4:
- **Client runtime tests are the primary safety net.** The hook is a thin wrapper that subscribes to the client's `state` event and delegates mutations. All protocol-level correctness lives in the client and is covered by `client.test.ts`.
- **The hook will be code-reviewed against the client API** during Slice 4 implementation to ensure mutations delegate correctly and effect cleanup matches the reconnect/teardown contract.
- **Slice 5 will add a DOM test environment** (likely `happy-dom` since it's lighter than `jsdom` and works with `bun:test`) and full `useCollabRoom.test.ts` coverage as part of editor integration.

This is explicit scope reduction with a named follow-up, not an implementation "if fiddly" fallback.

## Verification

```bash
# Tests
bun test packages/shared/collab/client-runtime/
bun test packages/shared/collab/          # ensure existing tests still pass
bun test apps/room-service/                # ensure server tests still pass

# Typechecks
bunx tsc --noEmit -p packages/shared/tsconfig.json
bunx tsc --noEmit -p apps/room-service/tsconfig.json
bunx tsc --noEmit -p packages/ui/tsconfig.collab.json   # scoped Slice 4 hook typecheck (useCollabRoom.ts only)
# Or: bun run typecheck (runs all four)
```

Slice 4 adds `packages/ui/tsconfig.collab.json` — a **scoped** verification config whose `include` list contains only `hooks/useCollabRoom.ts`. React/DOM libs plus `@types/react` / `@types/react-dom` devDependencies on `packages/ui` make it compile standalone. This is deliberately **not** a full `packages/ui` typecheck: the UI package carries pre-existing type debt (strict-mode violations, missing CSS side-effect decls, `bun:test` lib gaps) unrelated to Slice 4, and pulling all of that into a feature PR would blur the review. The scoped config verifies the new hook and is honest about its scope.

**Follow-up:** Full `packages/ui` typecheck is intentionally deferred because it surfaces pre-existing UI type debt unrelated to Slice 4. A dedicated cleanup PR should introduce a full `packages/ui/tsconfig.json` once that debt is addressed.

Integration test (requires `wrangler dev` running):
```bash
cd apps/room-service && bunx wrangler dev
# In another terminal:
SMOKE_BASE_URL=http://localhost:8787 bun test packages/shared/collab/client-runtime/integration.test.ts
```

## What This Slice Does NOT Do

- Wire `useCollabRoom` into `packages/editor/App.tsx` — Slice 5
- Share UI, cursor overlay, approve/deny integration — Slice 5
- Image attachment support — `RoomAnnotation.images` stays `never`
- Local `/api/external-annotations` SSE bridge — Slice 6
- Direct-agent usage guide or SDK docs — Slice 6
- Replace `apps/room-service/scripts/smoke.ts` — keep as independent reference
