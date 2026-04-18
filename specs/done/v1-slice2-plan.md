# Slice 2: `apps/room-service` — Worker + Durable Object Skeleton

## Context

Slice 1 created `packages/shared/collab` with protocol types, crypto helpers, and ID generators. Slice 2 builds the Cloudflare Worker + Durable Object that uses those helpers to create rooms and authenticate WebSocket connections. This is the service skeleton — no event sequencing, replay, presence relay, or admin commands.

## File Structure

```
apps/room-service/
  targets/cloudflare.ts    — Worker entry: Env, fetch handler, DO re-export
  core/handler.ts          — HTTP route dispatch
  core/room-do.ts          — Durable Object class (WebSocket hibernation API)
  core/types.ts            — Server-only types (RoomDurableState, WebSocketAttachment)
  core/cors.ts             — CORS (adapted from paste-service)
  core/log.ts              — Redaction-aware logging
  core/validation.ts       — Request body validation (pure, testable)
  wrangler.toml
  package.json
  tsconfig.json

  core/validation.test.ts  — Body validation tests
  core/auth.test.ts        — Auth proof round-trip tests (uses shared/collab crypto)
  scripts/smoke.ts         — Repeatable smoke test against wrangler dev (create room + WebSocket auth)
```

## Import Boundary

**Server runtime files** (`targets/` and `core/`) import ONLY from `@plannotator/shared/collab` (the server-safe barrel). Never from `@plannotator/shared/collab/client` or `collab/url`.

Server runtime imports:
- **Types:** `RoomStatus`, `SequencedEnvelope`, `CreateRoomRequest`, `CreateRoomResponse`, `AuthChallenge`, `AuthResponse`, `AuthAccepted`
- **Crypto:** `verifyAuthProof`
- **IDs:** `generateChallengeId`, `generateNonce`

**Test and smoke files** (`core/*.test.ts`, `scripts/smoke.ts`) act as external clients and may import from `@plannotator/shared/collab/client` — including `deriveRoomKeys`, `computeAuthProof`, `parseRoomUrl`, etc. — to simulate browser/agent auth flows. This is the same distinction as a real client connecting to the server.

## Files to Create

### 1. `package.json`

```json
{
  "name": "@plannotator/room-service",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "bun test"
  },
  "dependencies": {
    "@plannotator/shared": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241218.0",
    "wrangler": "^3.99.0"
  }
}
```

Explicit workspace dependency on `@plannotator/shared` — keeps the package graph honest for wrangler bundling, CI, and tooling.

### 2. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "types": ["@cloudflare/workers-types"]
  },
  "exclude": ["**/*.test.ts"]
}
```

Note `types: ["@cloudflare/workers-types"]` instead of `"node"` — this is a Cloudflare Worker, not Node/Bun runtime.

### 3. `wrangler.toml`

```toml
name = "plannotator-room"
main = "targets/cloudflare.ts"
compatibility_date = "2024-12-01"

[[durable_objects.bindings]]
name = "ROOM"
class_name = "RoomDurableObject"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RoomDurableObject"]

[vars]
ALLOWED_ORIGINS = "https://room.plannotator.ai,http://localhost:3001"
BASE_URL = "https://room.plannotator.ai"
```

DO binding named `ROOM`. Worker addresses rooms via `env.ROOM.idFromName(roomId)`. No KV — DO storage is sufficient.

### 4. `core/types.ts` — Server-Only Types

```ts
import type { RoomStatus, SequencedEnvelope } from '@plannotator/shared/collab';

/** Durable state stored in DO storage under key 'room'. */
export interface RoomDurableState {
  roomId: string;              // stored at creation — DO can't reverse idFromName()
  status: RoomStatus;
  roomVerifier: string;
  adminVerifier: string;
  seq: number;
  snapshotCiphertext?: string;
  snapshotSeq?: number;
  eventLog: SequencedEnvelope[];  // empty in Slice 2
  lockedAt?: number;
  deletedAt?: number;
  expiredAt?: number;
  expiresAt: number;
}

/**
 * WebSocket attachment — survives hibernation via serializeAttachment/deserializeAttachment.
 * Pre-auth: holds pending challenge state so the DO can verify after waking from hibernation.
 * Post-auth: holds authenticated connection metadata.
 */
export type WebSocketAttachment =
  | { authenticated: false; roomId: string; challengeId: string; nonce: string; expiresAt: number }
  | { authenticated: true; roomId: string; clientId: string; authenticatedAt: number };
```

### 5. `core/cors.ts`

Adapted from `apps/paste-service/core/cors.ts:1-27`. Change default origins to `https://room.plannotator.ai`. Same `getAllowedOrigins()` / `corsHeaders()` API. Identical localhost regex.

### 6. `core/log.ts` — Redaction

```ts
const REDACTED_KEYS = new Set([
  'roomVerifier', 'adminVerifier', 'proof', 'adminProof',
  'ciphertext', 'initialSnapshotCiphertext', 'snapshotCiphertext', 'nonce',
]);

export function redactForLog(obj: Record<string, unknown>): Record<string, unknown>
export function safeLog(label: string, obj: Record<string, unknown>): void
```

`redactForLog` shallow-clones and replaces values of sensitive keys with `"[REDACTED]"`. `safeLog` calls `console.log(label, redactForLog(obj))`.

### 7. `core/validation.ts` — Request Validation (Pure, Testable)

Extract validation as pure functions — no Cloudflare APIs, fully testable with `bun:test`.

```ts
export interface ValidationError { error: string; status: number }

export function validateCreateRoomRequest(body: unknown): CreateRoomRequest | ValidationError
export function clampExpiryDays(days: number | undefined): number  // clamps to [1, 30], default 30
```

`validateCreateRoomRequest` checks: body is object, `roomId` is non-empty string, `roomVerifier` is non-empty string, `adminVerifier` is non-empty string, `initialSnapshotCiphertext` is non-empty string. Returns the typed request or a `ValidationError`.

### 8. `core/handler.ts` — HTTP Route Dispatch

Receives `(request: Request, env: Env, cors: Record<string, string>)`. Pattern matches:

| Method | Path | Action |
|--------|------|--------|
| `OPTIONS` | `*` | 204 with CORS |
| `GET` | `/health` | `{ ok: true }` |
| `GET` | `/c/<roomId>` | Minimal HTML placeholder (text/html) |
| `GET` | `/assets/*` | 404 — intentionally deferred to Slice 5 (editor bundle) |
| `POST` | `/api/rooms` | Validate body → forward to DO → return response |
| `GET` | `/ws/<roomId>` | Check `Upgrade: websocket` header → forward to DO |
| `*` | `*` | 404 |

**Room creation flow:**
1. Parse JSON body, validate with `validateCreateRoomRequest()`
2. Get DO stub: `env.ROOM.get(env.ROOM.idFromName(body.roomId))`
3. Forward: `stub.fetch(new Request('http://do/create', { method: 'POST', body: JSON.stringify(body) }))`
4. Return DO response with CORS headers

**WebSocket flow:**
1. Extract roomId from `/ws/<roomId>` path
2. Check `Upgrade: websocket` header — 426 if missing
3. Get DO stub, forward the original request: `stub.fetch(request)`
4. Return DO response (101 Upgrade) — no CORS needed for WebSocket

The handler does NOT apply CORS to WebSocket upgrade responses (browsers don't send CORS preflight for WebSocket).

### 9. `targets/cloudflare.ts` — Worker Entry

Follows paste-service pattern exactly:

```ts
import { handleRequest } from '../core/handler';
import { corsHeaders, getAllowedOrigins } from '../core/cors';

export interface Env {
  ROOM: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  BASE_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = getAllowedOrigins(env.ALLOWED_ORIGINS);
    const cors = corsHeaders(origin, allowed);
    return handleRequest(request, env, cors);
  },
};

export { RoomDurableObject } from '../core/room-do';
```

The DO class must be re-exported at the top level for wrangler to discover it.

### 10. `core/room-do.ts` — Durable Object

The most complex file. Uses Cloudflare Workers Hibernation API.

**Class structure:**
```ts
export class RoomDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> { ... }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> { ... }
  async webSocketClose(ws: WebSocket): void { ... }
  async webSocketError(ws: WebSocket): void { ... }
}
```

No in-memory Map for challenge state. All per-connection state lives in the WebSocket attachment (`serializeAttachment` / `deserializeAttachment`), which survives hibernation.

**`fetch` routes:**

`POST http://do/create` — Room creation:
1. Parse body as `CreateRoomRequest`
2. Check existing: `await this.ctx.storage.get<RoomDurableState>('room')`
3. If exists and active/locked → 409 Conflict; if deleted/expired → 410 Gone
4. Build `RoomDurableState` with `status: 'active'`, `seq: 0`, `snapshotSeq: 0`, clamped expiry
5. Store: `await this.ctx.storage.put('room', state)`
6. Build `joinUrl` and `websocketUrl` from `BASE_URL` env var (no fragment, no query auth)
7. Return `CreateRoomResponse`

WebSocket upgrade (any request with `Upgrade: websocket`):
1. Load room state — 404 if missing, 410 if deleted or expired
2. Create `new WebSocketPair()`
3. Generate challenge: `{ challengeId, nonce, expiresAt: Date.now() + 30_000 }`
4. Accept server socket with hibernation: `this.ctx.acceptWebSocket(pair[1])`
5. Store pre-auth challenge state in WebSocket attachment (includes roomId for hibernation recovery):
   `pair[1].serializeAttachment({ authenticated: false, roomId, challengeId, nonce, expiresAt })`
6. Send `AuthChallenge` on server socket
7. Return `new Response(null, { status: 101, webSocket: pair[0] })`

**`webSocketMessage` handler:**

1. Read attachment: `const meta = ws.deserializeAttachment() as WebSocketAttachment`
2. Parse message as JSON
3. If `meta.authenticated === false` and `type === 'auth.response'`:
   - Check `authResponse.challengeId === meta.challengeId` — if not → close with 4002
   - Check `Date.now() <= meta.expiresAt` — if expired → close with 4003
   - Load room state; reject deleted or expired rooms before proof verification
   - Verify proof with `verifyAuthProof(roomState.roomVerifier, meta.roomId, authResponse.clientId, meta.challengeId, meta.nonce, authResponse.proof)`
   - If invalid → close with 4004
   - If valid → update attachment to authenticated: `ws.serializeAttachment({ authenticated: true, roomId: meta.roomId, clientId: authResponse.clientId, authenticatedAt: Date.now() })`, send `AuthAccepted`
4. If `meta.authenticated === false` and not `auth.response` → close with 4001
5. If `meta.authenticated === true` but non-auth message → ignore in Slice 2 (Slice 3 adds sequencing)

**roomId recovery:** The DO can't reverse `idFromName()`. `roomId` is stored in two places:
- **`RoomDurableState.roomId`** — set at creation from the `CreateRoomRequest` body. Source of truth.
- **`WebSocketAttachment.roomId`** — copied from durable state during WebSocket upgrade. Available in `webSocketMessage()` after hibernation without a storage read.

For the WebSocket upgrade `fetch`, the DO reads `roomId` from `RoomDurableState` (which it loads anyway to check room existence). For `webSocketMessage()`, it reads from the attachment — no request URL parsing needed.

**Hibernation safety:** All per-connection state lives in the WebSocket attachment via `serializeAttachment()` / `deserializeAttachment()`. Pre-auth connections store `{ authenticated: false, roomId, challengeId, nonce, expiresAt }`. Post-auth connections store `{ authenticated: true, roomId, clientId, authenticatedAt }`. If the DO hibernates mid-challenge, it wakes and reads the challenge + roomId from the attachment — no in-memory Map needed. This is the standard Cloudflare hibernation pattern.

**WebSocket close codes:**
- 4001: Authentication required (message before auth)
- 4002: Unknown challenge ID
- 4003: Challenge expired
- 4004: Invalid proof
- 4005: Protocol error
- 4006: Room unavailable

### 11. `core/validation.test.ts`

Tests for `validateCreateRoomRequest`:
- Valid request accepted
- Missing `roomId` → error
- Empty `roomId` → error
- Missing `roomVerifier` → error
- Missing `initialSnapshotCiphertext` → error
- Non-object body → error
- `expiresInDays` clamped: 0 → 1, 100 → 30, undefined → 30

### 12. `core/auth.test.ts`

End-to-end auth proof tests using `@plannotator/shared/collab` crypto:
- Generate room secret → derive keys → compute verifier → compute proof → verify proof (proves the server-side verification path works)
- Wrong proof → `verifyAuthProof` returns false
- Wrong roomId → returns false
- Malformed proof string → returns false (not throws)
- Challenge expiry detection (pure timestamp comparison)

These tests run with `bun:test` since `verifyAuthProof` uses only Web Crypto (available in Bun).

## Files to Modify

| File | Change |
|------|--------|
| Root `package.json` | Add `"dev:room": "bun run --cwd apps/room-service dev"` script |

## Implementation Order

1. `package.json`, `tsconfig.json`, `wrangler.toml` — scaffolding
2. `core/types.ts` — needed by everything
3. `core/log.ts` — standalone
4. `core/cors.ts` — adapted from paste-service
5. `core/validation.ts` + test — pure functions, testable first
6. `core/room-do.ts` — depends on types, log, validation, shared/collab
7. `core/handler.ts` — depends on cors, room-do (via Env)
8. `targets/cloudflare.ts` — depends on handler, cors, room-do
9. `core/auth.test.ts` — integration test for auth proof flow
10. `scripts/smoke.ts` — repeatable integration test against `wrangler dev`

## Verification

```bash
bun test apps/room-service/
```

Unit tests pass for validation and auth proof verification.

For integration testing (Worker + DO together):
```bash
cd apps/room-service && wrangler dev
# In another terminal:
bun run scripts/smoke.ts
```

`scripts/smoke.ts` is a repeatable smoke test that runs against a live `wrangler dev` instance. It uses `@plannotator/shared/collab/client` (client-safe — this is a test client, not server code) to:
- `POST /api/rooms` → verify fragmentless `joinUrl` and `websocketUrl`
- `POST /api/rooms` with same roomId → verify 409
- Open WebSocket to `/ws/<roomId>` → receive `AuthChallenge`
- Compute valid proof using shared/collab crypto → verify `AuthAccepted`
- Open WebSocket with wrong proof → verify close with error code
- `GET /health` → verify `{ ok: true }`

The smoke script exits 0 on success, non-zero on failure. This makes the verification gate repeatable without a full test framework for Cloudflare Workers.

## What This Slice Does NOT Do

- Event sequencing or `seq` increment
- Event log storage or replay
- Snapshot delivery after auth
- Presence relay
- Admin challenge-response or lock/unlock/delete
- Room expiry cleanup (alarm-based)
- Editor bundle serving
- Local SSE bridge or direct-agent client
