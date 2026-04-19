# V1 Decision Bridge and External Annotation Compatibility

This document explains how Plannotator Live Rooms interoperate with the existing local external-annotations SSE model and with direct agent clients. The complete room-service architecture lives in `specs/v1.md`; this file narrows in on the bridge behavior.

## Existing Local Flow

The current external annotation path is local and plaintext:

```text
agent/tool
  -> localhost:<port>/api/external-annotations
  -> local server in-memory annotation store
  -> SSE /api/external-annotations/stream
  -> browser useExternalAnnotations()
  -> editor allAnnotations
```

The relevant existing pieces are:

- `packages/shared/external-annotation.ts`: shared event vocabulary, validation, and in-memory mutation store.
- `packages/server/external-annotations.ts`: Bun HTTP + SSE adapter.
- `apps/pi-extension/server/external-annotations.ts`: Node/http mirror for Pi.
- `packages/ui/hooks/useExternalAnnotations.ts`: React EventSource consumer with polling fallback.
- `packages/editor/App.tsx`: merges local annotations with SSE-delivered external annotations into `allAnnotations`.
- `packages/ui/utils/planAgentInstructions.ts`: agent-facing instructions for reading `/api/plan` and posting `/api/external-annotations`.

## What Transfers

Transfer these concepts to room collaboration:

- snapshot/add/update/remove/clear event vocabulary
- source-based cleanup semantics
- batch annotation input shape
- `COMMENT` vs `GLOBAL_COMMENT` validation semantics
- stable annotation IDs and server-authoritative echo reconciliation
- agent-facing instruction style
- polling fallback pattern for local API environments

The decrypted room event vocabulary should mirror the useful pieces while using room-specific names and stable IDs. The canonical types live in `specs/v1.md` as `RoomClientOp` and `RoomServerEvent`; this file only restates the bridge-relevant annotation operations:

```ts
type RoomAnnotationOp =
  | { type: "annotation.add"; annotations: RoomAnnotation[] }
  | { type: "annotation.update"; id: string; patch: Partial<RoomAnnotation> }
  | { type: "annotation.remove"; ids: string[] }
  | { type: "annotation.clear"; source?: string };
```

`opId` is part of the encrypted `ServerEnvelope` metadata, not the decrypted operation payload. Room snapshots use the full encrypted `RoomSnapshot` shape from `specs/v1.md` so the plan markdown and stable annotation IDs travel together.

## What Does Not Transfer

Do not transfer these parts to `room-service`:

- plaintext server-side annotation storage
- SSE as the live room transport
- server-generated annotation IDs
- content-based dedupe as the primary dedupe strategy
- unauthenticated public room mutation endpoints

The existing local server may continue to see plaintext because it is running on the user's machine. The remote room service must store and relay ciphertext only.

## Local Bridge Mode

Local bridge mode preserves the current Plannotator model while adding encrypted room replication:

```text
agent/tool
  -> localhost:<port>/api/external-annotations
  -> local Plannotator SSE store
  -> creator/participant browser
  -> encrypt with eventKey
  -> room.plannotator.ai Durable Object
  -> other room clients
```

The existing local API remains valid:

```text
GET    /api/plan
GET    /api/external-annotations
GET    /api/external-annotations/stream
POST   /api/external-annotations
PATCH  /api/external-annotations?id=<id>
DELETE /api/external-annotations?id=<id>
DELETE /api/external-annotations?source=<source>
```

When a browser is joined to a room, annotations received from local SSE should be converted into encrypted room ops:

```text
SSE snapshot/add/update/remove/clear
  -> local browser reducer
  -> room annotation.add/update/remove/clear op
  -> encrypted ServerEnvelope
  -> room-service
```

The browser must prevent duplicates when an annotation received from local SSE is forwarded into the room and later echoed back. Use stable annotation IDs and the server-authoritative echo path: room-backed annotation state updates from the echoed event, not from a second local optimistic apply. `opId` remains useful protocol metadata for future ack/reject support, but V1 does not maintain an own-echo dedupe cache.

If a local SSE annotation includes image attachments, the bridge should strip the image fields before forwarding it as a `RoomAnnotation` op. V1 room annotations use `RoomAnnotation`, which excludes `images` because existing image attachments are local paths rather than portable encrypted assets. The annotation text content is still forwarded.

## Direct Agent Client Mode

Agents can also participate without a local Plannotator server if the user gives them the room URL:

```text
agent
  -> wss://room.plannotator.ai/ws/<roomId>
  -> challenge-response auth
  -> decrypt latest snapshot
  -> read plan + annotations
  -> send encrypted annotation ops
```

A direct agent client receives:

```text
https://room.plannotator.ai/c/<roomId>#key=<roomSecret>
```

The agent derives the same room keys as a browser client and uses shared collab helpers for:

- `parseRoomUrl`
- `deriveRoomKeys`
- `authenticateRoomSocket`
- `decryptSnapshot`
- `subscribeRoomEvents`
- `addAnnotation`
- `updateAnnotation`
- `removeAnnotation`
- `clearAnnotationsBySource`

Agents are clients. Giving an agent the full room URL grants it the ability to read the plan and annotations and submit encrypted annotations.

## Creator Agent Decision Bridge

The creator's browser is usually the bridge back to the primary local agent because it holds both:

- the encrypted room WebSocket/session
- `localhost:<port>` access to the running Plannotator server

Creator/admin-only controls:

- Approve
- Deny / Send Feedback
- Lock review
- Unlock review
- Delete room from Plannotator servers

Approve flow:

1. Browser consolidates all room annotations into `annotationsOutput`.
2. Browser POSTs to `localhost:<port>/api/approve`.
3. If approve succeeds, browser locks the room.
4. Room remains readable as a frozen review snapshot.

Deny flow:

1. Browser consolidates all room annotations into `annotationsOutput`.
2. Browser POSTs to `localhost:<port>/api/deny`.
3. Room remains active by default for the next revision cycle.

All participants, not just the creator, may export, copy, or download consolidated feedback from the encrypted room state. Only the creator/admin can submit approve/deny to their local agent bridge or lock/delete the room.

## Trust Boundary

In local bridge mode, the browser performs plaintext-to-encrypted translation: it receives plaintext annotations from localhost SSE, encrypts them with `eventKey`, and sends encrypted room envelopes to `room.plannotator.ai`.

This is not a server-side zero-knowledge break. The trusted boundary is:

```text
trusted: user's browser, user's local machine, user's chosen local agent
untrusted/zero-knowledge: room.plannotator.ai
```

Clients can read plaintext; the remote room server cannot.
