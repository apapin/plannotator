# Slice 3: Durable Room Engine

## Context

Slices 1-2 created the collab protocol contract and the room-service skeleton (room creation + WebSocket auth). Slice 3 fills in the actual room behavior: event sequencing, presence relay, reconnect replay, admin commands, and lifecycle enforcement. After Slice 3, two test clients can create a room, exchange encrypted annotations in real time, lock/unlock/delete, and reconnect with catch-up replay.

**Zero-knowledge constraint:** The DO stores ciphertext only and cannot decrypt events or build snapshots. Snapshots enter the DO only via room creation (`initialSnapshotCiphertext`) and `room.lock` (`finalSnapshotCiphertext`). Standalone admin-authenticated snapshot upload is deferred.

## Storage Layout

Events are stored as **separate per-event keys**, not as an array in the room state. This is critical because SQLite-backed DO storage has a 2 MB combined key+value limit per entry. A single event ciphertext can be up to 512 KB, so storing even a few events in one JSON value would exceed limits.

**Key layout:**
- `room` → room metadata only (status, verifiers, seq, snapshotSeq, snapshot ciphertext, timestamps). No event array.
- `event:0000000001` → individual `SequencedEnvelope` (10-digit zero-padded seq for lexicographic ordering)
- `event:0000000002` → individual `SequencedEnvelope`
- etc.

`RoomDurableState` changes from Slice 2: **remove `eventLog: SequencedEnvelope[]`**, add `earliestRetainedSeq: number` to track the oldest event still in storage.

For replay: use `ctx.storage.list({ prefix: 'event:', start: 'event:...' })` to efficiently read a range.
For purge (delete/expire): iterate and delete all event keys from `earliestRetainedSeq` through `seq`.

## Snapshot and Compaction Policy (V1)

For V1, **no standalone snapshot upload or compaction during active rooms**. Snapshots exist from two sources:
1. Room creation — `initialSnapshotCiphertext` with `snapshotSeq: 0`
2. Room lock — optional `finalSnapshotCiphertext` with `finalSnapshotAtSeq`

The event log grows during active rooms. This is acceptable because:
- Rooms expire after 30 days max
- A typical review session produces 10-50 annotation events
- Each event is stored as a separate key (no single-value size pressure)
- SQLite-backed DO storage has ample total capacity for this

Reconnect uses the latest available snapshot plus retained events after `snapshotSeq`.

Admin-authenticated snapshot upload with challenge-response is future scope. `SnapshotUpload` and `CompactionHint` types are deferred.

## What Changes

### `packages/shared/collab/types.ts` — Type Changes

**Extend `AdminCommand` lock variant:**
```ts
| { type: 'room.lock'; finalSnapshotCiphertext?: string; finalSnapshotAtSeq?: number }
```
If the admin provides a final snapshot when locking, `finalSnapshotAtSeq` must be provided and valid (`<= current seq`, `>= existing snapshotSeq`). The DO stores it as the new `snapshotCiphertext` and `snapshotSeq`.

**Add error transport type:**
```ts
interface RoomErrorMessage {
  type: 'room.error';
  code: string;
  message: string;
}
```

**Extend `RoomTransportMessage`:**
```ts
| { type: 'room.error'; code: string; message: string }
```

### `apps/room-service/core/types.ts` — Storage + Attachment Changes

**Remove `eventLog` from `RoomDurableState`**, add `earliestRetainedSeq`:
```ts
interface RoomDurableState {
  roomId: string;
  status: RoomStatus;
  roomVerifier: string;
  adminVerifier: string;
  seq: number;
  earliestRetainedSeq: number; // oldest event seq still in storage; initialized to 1 at creation
  snapshotCiphertext?: string;
  snapshotSeq?: number;
  // eventLog REMOVED — events stored as separate 'event:NNNNNNNNNN' keys
  lockedAt?: number;
  deletedAt?: number;
  expiredAt?: number;
  expiresAt: number;
}
```

**`earliestRetainedSeq` lifecycle:** Initialized to `1` at room creation (no events yet, first event will be seq 1). While no events exist (`seq === 0`), replay detects the empty log and sends the snapshot. Once events are stored, `earliestRetainedSeq` tracks the oldest key. For V1 (no compaction), it stays at `1` — future compaction would advance it.
```

**Extend post-auth `WebSocketAttachment`:**
```ts
{
  authenticated: true;
  roomId: string;
  clientId: string;
  authenticatedAt: number;
  pendingAdminChallenge?: { challengeId: string; nonce: string; expiresAt: number };
}
```

Every code path that generates, consumes, or clears a `pendingAdminChallenge` must call `ws.serializeAttachment()` to persist across hibernation.

### `apps/room-service/core/validation.ts` — New Validators

Add pure validation functions:

- **`validateServerEnvelope(msg)`** — validates clientId, opId, channel (`"event"` | `"presence"`), ciphertext. Size limits:
  - Event ciphertext: max 512 KB (generous for a single annotation op)
  - Presence ciphertext: max 8 KB (cursor position + user info is small)
- **`validateAdminCommandEnvelope(msg)`** — validates type, challengeId, clientId, adminProof, command shape. For `room.lock`: `finalSnapshotCiphertext` and `finalSnapshotAtSeq` must be either both present or both absent. If ciphertext present: validates ≤1.5 MB. If `atSeq` present: validates non-negative integer. Rejects if only one of the pair is provided.

### `apps/room-service/core/room-do.ts` — The Core Engine

#### Post-Auth Message Dispatch

Replace the Slice 2 stub with a type dispatcher. `ServerEnvelope` has no `type` field — detect via `channel` field. Other messages have `type`:

```
if msg.type === 'admin.challenge.request' → handleAdminChallengeRequest
if msg.type === 'admin.command'           → handleAdminCommand
if msg.channel ('event'|'presence')       → handleServerEnvelope
else → close with protocol error
```

#### Event Sequencing (`channel: "event"`)

1. Load room state, check `active` (locked → send `room.error` but don't close; deleted/expired → close)
2. **Override `envelope.clientId` with authenticated `meta.clientId`** — prevents spoofing
3. Increment `roomState.seq`, create `SequencedEnvelope`
4. **Store full `SequencedEnvelope` as separate key:** `ctx.storage.put('event:' + padSeq(seq), sequencedEnvelope)` — the value includes `seq`, `receivedAt`, and `envelope` so replay can reconstruct `room.event` transport messages without deriving fields from the key. Update room metadata (`seq`).
5. **Broadcast `room.event` to ALL authenticated sockets including sender** — the sender needs the echo to advance its `lastSeq` and confirm `opId`. The client uses `opId` matching to detect its own events as server-confirmed.

#### Presence Relay (`channel: "presence"`)

1. Check `active` or `locked` (presence allowed in locked rooms per spec)
2. Override `envelope.clientId` with authenticated `meta.clientId`
3. **Broadcast `room.presence` to all OTHER authenticated sockets** — presence is volatile, sender doesn't need an echo
4. No storage write, no seq

#### Reconnect Replay (after auth.accepted)

Immediately after sending `auth.accepted`:

- If `lastSeq === roomState.seq`: no replay needed (fully caught up)
- If `lastSeq > roomState.seq`: invalid — client claims a future position. Fall back to snapshot replay (same as "too old" path). Log the anomaly.
- If `lastSeq` provided and `lastSeq >= roomState.earliestRetainedSeq`: read events from storage via `ctx.storage.list({ prefix: 'event:', start: padSeq(lastSeq + 1) })`, send each as `room.event`
- If `lastSeq` not provided or `lastSeq < earliestRetainedSeq`: send latest snapshot as `room.snapshot`, then replay all retained events after `snapshotSeq` via `ctx.storage.list()`

#### Admin Challenge-Response

1. `admin.challenge.request` → generate fresh challenge, store in attachment's `pendingAdminChallenge` (serialize attachment), send `AdminChallenge`
2. `admin.command` → validate `msg.clientId === meta.clientId` (reject cross-connection spoofing), save challenge data to local variable, clear from attachment (serialize), verify proof with `verifyAdminProof()` using stored `adminVerifier` and `meta.clientId` (not `msg.clientId`), apply command

Every attachment mutation serializes immediately.

Command execution:

**`room.lock`:**
- Check status is `active`
- If `finalSnapshotCiphertext` + `finalSnapshotAtSeq` provided: validate `atSeq <= roomState.seq` and `atSeq >= (roomState.snapshotSeq ?? 0)`, store as new snapshot
- Set `status: 'locked'`, `lockedAt: Date.now()`
- Persist, broadcast `room.status { status: 'locked' }` to all sockets

**`room.unlock`:**
- Check status is `locked`
- Set `status: 'active'`, clear `lockedAt`
- Persist, broadcast `room.status { status: 'active' }` to all sockets

**`room.delete`:**
- Check status is `active` or `locked`
- Purge sensitive material: blank verifiers, clear snapshot, delete all `event:*` keys via `ctx.storage.list({ prefix: 'event:' })` + `ctx.storage.delete()`
- Set `status: 'deleted'`, `deletedAt: Date.now()`
- Persist room metadata, broadcast `room.status { status: 'deleted' }`, close all sockets

#### Broadcast Helpers

```ts
private broadcastToAll(message: RoomTransportMessage): void
private broadcastToOthers(exclude: WebSocket, message: RoomTransportMessage): void
```

Both iterate `ctx.getWebSockets()`, skip unauthenticated sockets.

#### Lifecycle Enforcement Matrix

| Message | `active` | `locked` | `deleted`/`expired` |
|---------|----------|----------|---------------------|
| Event envelope | Sequence + broadcast to all | Send `room.error` (don't close) | Close socket |
| Presence envelope | Broadcast to others | Broadcast to others | Close socket |
| admin.challenge.request | Accept | Accept | Close socket |
| admin lock | Accept | Reject (already locked) | Close socket |
| admin unlock | Reject (not locked) | Accept | Close socket |
| admin delete | Accept | Accept | Reject (terminal) |

`room.error` messages for recoverable errors (locked room, invalid admin state) keep the socket open for presence/admin operations.

#### Per-Message Size Limits

| Message Type | Max Ciphertext | Rationale |
|---|---|---|
| Event envelope | 512 KB | Single annotation op |
| Presence envelope | 8 KB | Cursor + user info |
| Lock finalSnapshotCiphertext | 1.5 MB | Full room snapshot |

## New Test File

### `apps/room-service/core/room-engine.test.ts`

Imports from `@plannotator/shared/collab/client` (acting as external client).

**Validation tests:**
- `validateServerEnvelope` — valid event/presence, missing fields, wrong channel, event oversized (>512 KB), presence oversized (>8 KB)
- `validateAdminCommandEnvelope` — valid lock/unlock/delete, missing fields, unknown command, lock with oversized snapshot, lock with finalSnapshotAtSeq validation

**Admin proof round-trip:**
- Full chain: admin secret → key → verifier → proof → verify
- Wrong proof rejected
- Lock proof can't verify as delete (canonicalJson command binding)

### `scripts/smoke.ts` — Required Extensions

**Not optional.** Slice 3's acceptance criteria are WebSocket behaviors that need integration testing:
- Two authenticated clients: send event envelope → both receive `room.event` (including sender echo)
- Send presence → only OTHER client receives `room.presence`
- Admin lock → both clients receive `room.status { locked }`
- Locked room rejects event → sender receives `room.error`
- Admin unlock → both receive `room.status { active }`
- Admin delete → both receive `room.status { deleted }`, sockets close
- Reconnect: client 2 disconnects, client 1 sends events, client 2 reconnects with `lastSeq` → replayed events arrive

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/collab/types.ts` | Add `finalSnapshotAtSeq` to lock command, add `RoomErrorMessage`, extend `RoomTransportMessage` |
| `apps/room-service/core/types.ts` | Add `pendingAdminChallenge?` to post-auth attachment |
| `apps/room-service/core/validation.ts` | Add `validateServerEnvelope`, `validateAdminCommandEnvelope`, size limit constants |
| `apps/room-service/core/room-do.ts` | Implement post-auth handlers, reconnect, admin flow, lifecycle enforcement |
| `apps/room-service/scripts/smoke.ts` | Add event/presence/admin/reconnect integration tests |

## Files to Create

| File | Purpose |
|------|---------|
| `apps/room-service/core/room-engine.test.ts` | Validation + admin proof + unit tests |

## Implementation Order

1. `packages/shared/collab/types.ts` — type changes
2. `apps/room-service/core/types.ts` — attachment extension
3. `apps/room-service/core/validation.ts` — new validators + constants
4. `apps/room-service/core/room-do.ts`:
   a. New imports, constants, broadcast helpers
   b. Reconnect replay in `handleAuthResponse`
   c. Post-auth message dispatch
   d. `handleServerEnvelope` (event sequencing + presence relay)
   e. `handleAdminChallengeRequest`
   f. `handleAdminCommand` (lock/unlock/delete)
5. `apps/room-service/core/room-engine.test.ts`
6. `apps/room-service/scripts/smoke.ts` extensions

## Verification

```bash
bun test apps/room-service/ && bun test packages/shared/collab/
bunx tsc --noEmit -p apps/room-service/tsconfig.json
bunx tsc --noEmit -p packages/shared/tsconfig.json
```

Integration testing (required):
```bash
cd apps/room-service && wrangler dev
# In another terminal:
bun run scripts/smoke.ts
```

Smoke test verifies:
- Two clients exchange encrypted events in real time (both receive including sender)
- Presence broadcasts to others only
- Admin lock/unlock/delete with challenge-response
- Locked room rejects events, allows presence
- Reconnect replays correct events from lastSeq
- Deleted room closes sockets and rejects new joins with 410

Expired room behavior is verified via `hasRoomExpired` unit tests and the lazy expiry enforcement already in the DO (tested in Slice 2). The smoke test cannot naturally create an expired room since minimum expiry is 1 day.

## What This Slice Does NOT Do

- Standalone snapshot upload or compaction (admin-authenticated upload is future scope)
- `CompactionHint` or `SnapshotUpload` message types
- React hooks, browser UI, editor integration
- Local SSE bridge or direct-agent client UX
- Approve/deny flow or cursor overlay
