# Plannotator Live Rooms V1 Implementation Approach

This document describes how to implement Plannotator Live Rooms without turning the work into one oversized change. The product rationale lives in `specs/v1-prd.md`. The protocol and room-service details live in `specs/v1.md`. The agent/SSE bridge details live in `specs/v1-decisionbridge.md`.

The implementation should be a stack of reviewable slices. Each slice should create a real, testable building block that the next slice imports instead of reimplementing.

## Guiding Constraints

The spine of the implementation is `packages/shared/collab`. It owns the canonical protocol types, key derivation helpers, encryption helpers, challenge-response helpers, URL helpers for clients, image-stripping helpers, and test vectors. Later slices should import from this package rather than creating local copies of the protocol.

The room server must not parse full room URLs. URL fragments are client-only. `parseRoomUrl()` is for browser and direct-agent clients that receive:

```text
https://room.plannotator.ai/c/<roomId>#key=<roomSecret>
```

The Worker and Durable Object never receive the fragment and must not accept full room URLs as input. They receive only `roomId` through `/api/rooms` request bodies or `/ws/<roomId>` routes, plus verifiers, proofs, ciphertext, and non-secret metadata in request or WebSocket message bodies.

Each slice should preserve these invariants:

- no `roomSecret`, `adminSecret`, `authKey`, `eventKey`, `presenceKey`, or `adminKey` crosses the network
- no WebSocket query-string auth
- no server-side plaintext plan, annotation, comment, cursor, display name, color, or selected annotation state
- no room-service dependency on the existing paste-service KV storage model
- no CRDT or document editing work in V1
- no encrypted room assets in V1; strip image attachments and notify
- no local SSE concepts copied into the remote room service except the compatible operation vocabulary

## Slice 1: Shared Collab Contract

Create `packages/shared/collab` as the canonical protocol package.

This slice should include:

- room schemas and discriminated unions for transport messages, `ServerEnvelope`, `RoomClientOp`, `RoomServerEvent`, `RoomSnapshot`, `RoomAnnotation`, `PresenceState`, room auth messages, and admin command messages
- `roomId`, `opId`, `clientId`, challenge ID, and nonce helpers
- HKDF/HMAC key derivation helpers for `authKey`, `eventKey`, `presenceKey`, and `adminKey`
- verifier/proof helpers for room auth and admin command auth
- `canonicalJson()` for admin command proof binding
- encryption/decryption helpers for event payloads, presence payloads, and snapshots
- client-only room URL helpers such as `parseRoomUrl()` and `buildRoomJoinUrl()`
- helpers to convert existing `Annotation` values into V1 `RoomAnnotation` values by stripping image attachments
- test vectors for key derivation, verifiers, proofs, canonical JSON, encrypted envelopes, and URL parsing

This slice should not include a Worker, Durable Object, React hook, or editor integration. It is the contract everything else builds on.

Verification gate:

- unit tests pass for schema validation, key derivation, verifier/proof generation, canonical JSON stability, encryption/decryption round trips, image stripping, and URL parsing
- a negative test proves that malformed room URLs and missing fragments are rejected by client helpers
- a server-oriented import test or lint boundary makes clear that server code imports schema/proof helpers but not browser-only URL parsing
- manual review confirms there is one canonical set of operation names: `annotation.add`, `annotation.update`, `annotation.remove`, `annotation.clear`, and `presence.update`

## Slice 2: Room-Service Skeleton

Add `apps/room-service` as a Cloudflare Worker with a Durable Object namespace, but keep behavior narrow.

This slice should include:

- Cloudflare Worker entrypoint and configuration
- routing for:
  ```text
  GET  /health
  GET  /c/<roomId>
  GET  /assets/*
  POST /api/rooms
  GET  /ws/<roomId>
  ```
- room creation that stores `roomVerifier`, `adminVerifier`, encrypted initial snapshot, `seq = 0`, `snapshotSeq = 0`, status `active`, and fixed expiry
- duplicate `roomId` rejection with `409 Conflict`
- create response that returns `joinUrl` without a fragment and `websocketUrl` without query-string auth
- WebSocket upgrade into the room Durable Object
- connection challenge-response auth using the shared proof helpers
- `auth.accepted` after successful auth
- redaction for proofs, verifiers, ciphertext, message bodies, and request bodies in logs

This slice should not implement annotation sequencing, replay, presence relay, admin commands, or editor UI. Its job is to prove the service boundary, creation path, and authentication path.

Verification gate:

- Worker tests can create a room and receive a fragmentless `joinUrl`
- duplicate room creation returns `409 Conflict`
- invalid proofs are rejected and valid proofs are accepted
- challenges expire and cannot be reused
- WebSocket URLs do not contain auth material
- server tests pass using only `roomId`, verifier/proof helpers, and encrypted snapshot inputs; no server test should need a full `https://...#key=...` room URL

## Slice 3: Durable Room Engine

Fill in the Durable Object room behavior.

This slice should include:

- durable sequencing for `channel: "event"` envelopes
- volatile relay for `channel: "presence"` envelopes
- encrypted event log storage with `seq` and `receivedAt`
- encrypted snapshot storage with `snapshotSeq`
- V1 does NOT implement active compaction. The DO retains all durable events for the room's lifetime (`earliestRetainedSeq` stays at 1). Admin-initiated `lockRoom({ finalSnapshot })` writes a final snapshot used by future joins. Post-V1 work may introduce a snapshot-after-N-ops / snapshot-after-N-KiB rule; the replay path already checks `lastSeq >= earliestRetainedSeq` and falls back to snapshot replay when compaction advances that cursor.
- reconnect behavior using `lastSeq`: replay if retained, otherwise send latest encrypted snapshot and retained events after `snapshotSeq`
- `active`, `locked`, `deleted`, and `expired` lifecycle enforcement
- admin challenge-response per command for lock, unlock, and delete
- `410 Gone` behavior for deleted and expired rooms
- retention cleanup for expired rooms with distinct `expired` status, not creator-initiated `deleted`

This slice should still be test-client driven. It should not depend on React or editor code.

Verification gate:

- two test clients can authenticate to the same room and exchange encrypted durable events
- only durable event envelopes receive `seq`; presence is broadcast but not persisted
- reconnect from a retained `lastSeq` replays the correct events
- reconnect from a compacted `lastSeq` sends snapshot plus retained events
- locked rooms reject annotation mutations but still allow snapshot reads and presence by the V1 policy
- unlock returns the room to active state
- delete closes or rejects room access and future joins return `410 Gone`
- expiry closes or rejects room access and future joins return `410 Gone` with an expired-room reason
- invalid admin proofs, reused admin challenges, and expired admin challenges are rejected

## Slice 4: Browser And Agent Collab Client

Build the client runtime on top of `packages/shared/collab` and the room-service API.

This slice should include:

- `useCollabRoom` under `packages/ui/hooks`
- a lower-level collab client usable by browser code and direct-agent clients
- client-side parsing of `/c/<roomId>#key=...`
- room key derivation in the client only
- room creation helper that generates `roomId`, `roomSecret`, `adminSecret`, verifiers, and encrypted initial snapshot
- join helper that authenticates, receives `auth.accepted`, requests replay/snapshot based on `lastSeq`, and decrypts room messages
- server-authoritative annotation apply: send encrypted ops, then update local room state from the echoed `room.event`
- stable `clientId` per WebSocket connection and stable encrypted `PresenceState.user.id`
- reconnect behavior with `lastSeq`
- methods for `sendAnnotationAdd`, `sendAnnotationUpdate`, `sendAnnotationRemove`, `sendAnnotationClear`, `sendPresence`, `lockRoom`, `unlockRoom`, and `deleteRoom`
- a direct-agent client surface that exposes decrypted room state and annotation mutation helpers after the user gives the agent the full room URL

This slice should not yet modify the main editor UI. It should be runnable against the Slice 3 room service using test harnesses or a minimal dev page.

Verification gate:

- client tests prove full room URLs are parsed only in client/direct-agent code
- browser client can create a room, join it, decrypt the initial snapshot, and send encrypted ops against the Slice 3 service
- direct-agent client can receive a full room URL, derive keys locally, authenticate, decrypt the snapshot, and submit an encrypted annotation op
- reconnect tests cover retained replay and snapshot fallback
- echo tests prove mutation sends do not update local room state until the server echo, and own echoes apply through the same server-authoritative path as peer events

## Slice 5: Editor Product Integration

Wire the browser client into the existing Plannotator editor.

This slice should include:

- “Start live room” in the share UI, separate from hash and paste links
- room link copy using `https://room.plannotator.ai/c/<roomId>#key=<roomSecret>`
- room status badge and connected participant presence
- remote cursor overlay in `Viewer`, not as annotations
- annotation create/update/remove/clear paths that emit encrypted room ops when in a room, show lightweight pending feedback, and update room-backed annotation state from the server echo
- remote annotation ops applied without regenerating IDs
- image attachment stripping when entering a room, with clear user notice
- creator/admin controls for lock, unlock, and “Delete room from Plannotator servers”
- approve flow that consolidates room annotations, POSTs to the local approve endpoint, and locks the room after success
- deny flow that consolidates room annotations and POSTs to the local deny endpoint while leaving the old room active for the old plan
- export/copy consolidated feedback for all participants
- no changes to existing static sharing behavior

This slice should produce the first human-usable live room.

### Production hardening: rate-limit `POST /api/rooms`

Room creation is intentionally unauthenticated in the V1 protocol — a room is a capability token pair (roomSecret + adminSecret) the creator generates locally, and `POST /api/rooms` only asserts existence, not identity. Before public deployment, the route MUST be protected by one of:

- Cloudflare rate limiting / WAF rule keyed on source IP + path
- an application-level throttle at the Worker entry (e.g. a shared Durable Object counter or KV-based token bucket)
- an authenticated proxy in front of the Worker (plannotator.ai app calls it on behalf of signed-in users)

CORS is NOT abuse protection — it's a browser same-origin policy that does nothing to a direct HTTP client. This is a production requirement, not a Slice 4 runtime gap; the V1 protocol is designed to allow this additive gating without client changes. Recorded here so future reviewers do not re-flag it as a protocol issue.

### URL-fragment credential hygiene

Room credentials live in the URL fragment (`#key=…&admin=…`) and never touch the network as query params. Browsers already strip URL fragments from outbound `Referer` headers, so the fragment itself is not what escapes; the server sets `Referrer-Policy: no-referrer` on `/c/:roomId` as belt-and-braces — it strips the path (which carries the room id) and the origin from any outbound `Referer` the page triggers, reducing third-party exposure. The real credential-leak channel on this page is JavaScript reading `window.location.href`. The editor code that ships in this slice MUST:

- not send `window.location.href`, `document.referrer`, or any serialized URL to telemetry, error-reporting, analytics, or third-party logging services without first scrubbing the `#key=` and `#admin=` fragment params.
- treat any tool that captures "page URL" (Sentry, Datadog RUM, custom ingestion) as a secret-leak channel until a scrubbing layer is in place.
- prefer redacting to the `pathname` + non-credential fragment params only, or to a stable route identifier.

Verification gate:

- local dev can start the editor and room service together
- two browser sessions can join the same room and see annotations appear in both sessions
- cursor presence renders without being stored as annotations
- locked room prevents new annotation mutations and remains readable
- unlock restores annotation ability
- delete removes server-side room state and later joins fail
- approve sends consolidated feedback to the local agent bridge and locks the room on success
- deny sends consolidated feedback to the local agent bridge and leaves the old room active for the old plan
- static hash sharing and paste-service short links still work
- room creation with image attachments strips images, preserves text annotations, and shows the notice

## Slice 6: Agent Bridge And Direct-Agent Hardening

Wire room collaboration into the existing local external-annotations flow and document direct-agent usage.

This slice should include:

- bridge from existing `/api/external-annotations` SSE events into encrypted room ops when the browser is joined to a room
- mapping for snapshot/add/update/remove/clear into `annotation.add`, `annotation.update`, `annotation.remove`, and `annotation.clear`
- source-based cleanup semantics for agent reruns
- image stripping for local SSE annotations before forwarding as `RoomAnnotation`
- duplicate prevention between local SSE annotations and echoed room events using stable IDs and the single server-authoritative apply path
- agent-facing instructions for direct room clients that make the security model explicit
- examples or tests showing an agent can connect as an end client when the user gives it the full room URL

This slice should not make the room service aware of Claude Code, OpenCode, Codex, or any local agent loop. The room service remains an encrypted coordination service only.

Verification gate:

- existing local external annotations still work outside rooms
- while joined to a room, local SSE `add`, `update`, `remove`, and `clear` produce encrypted room ops
- source-based clear removes the intended agent annotations across room participants
- image-bearing local annotations forward text content and strip image fields
- direct-agent client can read the decrypted plan and submit encrypted annotations after being given the full room URL
- room-service logs and server APIs still never receive room secrets or plaintext annotations

## Stack Discipline

Treat these as stacked PRs:

1. shared collab contract
2. room-service skeleton
3. durable room engine
4. browser/direct-agent client
5. editor product integration
6. agent bridge and direct-agent hardening

Do not merge a later slice by inventing temporary protocol shapes that disagree with earlier slices. If a later slice finds a flaw in the shared protocol, update `packages/shared/collab` and its tests first, then adjust dependent slices.

Each slice should include enough tests or harnesses to prove it works without waiting for the whole feature. The goal is not to ship six independent product features; the goal is to make one product feature reviewable in six coherent layers.

## Known Post-V1 Follow-Ups

Keep these out of V1 unless a V1 decision explicitly changes:

- multi-version room documents and version tabs
- participant-submitted plan versions
- annotation carry-forward/resolution across versions
- encrypted image/blob assets, likely backed by R2
- room key rotation and revocation
- login-backed identity or verified participant identity
- role-based moderation beyond creator/admin lock, unlock, and delete
- client-side hash chains for tamper evidence
- activity-based TTL extension
- multi-admin support — V1 assumes a single creator-held admin capability, so the client resolves admin commands by observing `room.status` transitions rather than command-specific acks. Multi-admin requires a protocol change: add `commandId` to `AdminCommandEnvelope` and an `admin.result { commandId, ok, error? }` message from the room service so concurrent admin commands can be disambiguated.
- presence performance — **must be addressed in Slice 5, not documentation-only.** Every remote cursor update calls `emitState()`, which clones the full annotations array. With large plans and typical cursor-update frequencies (30–60 Hz on active typing), this causes visible render jank. Slice 5 must at minimum throttle `sendPresence()` emissions (50–100ms, trailing-edge) before wiring remote cursors into the editor UI. Longer-term fix: split presence from the annotation `state` event entirely (so presence-only updates don't trigger annotation-array cloning) or preserve stable annotation-array references across presence-only state snapshots. Don't ship the editor integration until one of these lands.
