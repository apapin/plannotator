# Slice 1: `packages/shared/collab` — Protocol Contract

## Context

This is the first implementation slice for Plannotator Live Rooms. The spec (`specs/v1.md`), PRD (`specs/v1-prd.md`), and implementation approach (`specs/v1-implementation-approach.md`) describe a zero-knowledge encrypted collaboration system backed by Cloudflare Durable Objects. Slice 1 creates the foundational `packages/shared/collab` package that every subsequent slice (room service, browser client, editor integration, agent bridge) imports from.

No server, no UI, no React hooks — just types, crypto, and helpers with thorough tests.

## File Structure

Create `packages/shared/collab/` as a subdirectory:

```
packages/shared/collab/
  index.ts              — server-safe barrel (types, crypto, ids, encoding, strip-images)
  client.ts             — client barrel (re-exports index + url helpers)
  types.ts              — all room protocol types
  encoding.ts           — exported base64url encode/decode
  canonical-json.ts     — deterministic JSON for admin proof binding
  crypto.ts             — HKDF, HMAC, AES-GCM
  ids.ts                — roomId, opId, clientId, secret generation
  url.ts                — client-only URL parsing (parseRoomUrl, buildRoomJoinUrl)
  strip-images.ts       — Annotation → RoomAnnotation conversion

  encoding.test.ts
  canonical-json.test.ts
  crypto.test.ts
  ids.test.ts
  url.test.ts
  strip-images.test.ts
```

Add to `packages/shared/package.json` exports:
```json
"./collab": "./collab/index.ts",
"./collab/client": "./collab/client.ts"
```

## Files to Create

### 1. `collab/types.ts` — Protocol Types

All types from `specs/v1.md` Room Ops and Events section. No runtime code, no imports.

`RoomAnnotation` must be defined structurally (not `Omit<Annotation, "images">`) because `@plannotator/shared` cannot import from `@plannotator/ui` — the dependency direction is `ui → shared`. Match every field of `Annotation` from `packages/ui/types.ts:26-52` except `images`, set `images?: never`.

Since `AnnotationType` (the enum) also lives in `@plannotator/ui`, define the `type` field as a string literal union: `type: "DELETION" | "COMMENT" | "GLOBAL_COMMENT"`. Do not use `type: string` — that would weaken validation and allow arbitrary values through room ops.

Client/shared types to define:
- `RoomAnnotation`, `RoomSnapshot`, `RoomStatus`
- `ServerEnvelope`, `SequencedEnvelope`
- `RoomClientOp`, `RoomServerEvent`, `RoomTransportMessage`
- `PresenceState`, `CursorState`
- `AuthChallenge`, `AuthResponse`, `AuthAccepted`
- `AdminCommand`, `AdminChallengeRequest`, `AdminChallenge`, `AdminCommandEnvelope`
- `CreateRoomRequest`, `CreateRoomResponse`
- `AgentReadableRoomState`

**Do NOT export `RoomState` from this package.** `RoomState` contains server-only fields (`roomVerifier`, `adminVerifier`, event log) that belong to the Durable Object storage layer, not the shared client contract. Define `RoomState` later in Slice 2 (`apps/room-service`) where the DO lives. The barrel `index.ts` must not re-export any server-internal storage types.

Comment at the top referencing `packages/ui/types.ts` as the source of truth for `Annotation`, noting that new Annotation fields must be manually added to `RoomAnnotation`.

### 2. `collab/encoding.ts` — Base64url Helpers

Export base64url encode/decode. The existing `packages/shared/crypto.ts:81-97` has unexported local helpers — don't modify that file, create robust exports here.

```ts
export function bytesToBase64url(bytes: Uint8Array): string
export function base64urlToBytes(b64: string): Uint8Array
```

Uses only `btoa`/`atob` and loop-based `String.fromCharCode` (handles payloads > 65K).

**Improvement over existing helper:** The existing `base64urlToBytes` in `crypto.ts` does not normalize base64 padding before calling `atob`. This works in some runtimes but is not guaranteed across browser/Bun/Workers. The new `base64urlToBytes` must add `=` padding based on `length % 4` before calling `atob`:
```ts
// Normalize padding
const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
```
Add tests for valid unpadded inputs (lengths 2 and 3 mod 4), and reject length 1 mod 4 as malformed (no valid byte count produces that length).

### 3. `collab/canonical-json.ts` — Deterministic Serialization

Per `specs/v1.md:319`: sorted keys at every nesting level, no whitespace, UTF-8 bytes. Arrays preserve order. `undefined` fields omitted. Throws on `NaN`, `Infinity`, functions, symbols.

```ts
export function canonicalJson(value: unknown): string
```

Recursive implementation: handle null, boolean, number (reject NaN/Infinity), string, arrays (recurse elements), plain objects (`Object.keys(obj).sort()`, recurse values, skip undefined).

### 4. `collab/crypto.ts` — HKDF + HMAC + AES-GCM

The most complex file. Imports from `./encoding.ts` and `./canonical-json.ts`. Uses only Web Crypto API (`crypto.subtle`).

**Key derivation (HKDF):**
- `deriveRoomKeys(roomSecret: Uint8Array)` → `{ authKey, eventKey, presenceKey }`
- `deriveAdminKey(adminSecret: Uint8Array)` → `CryptoKey`
- Internal: `deriveHmacKey(material, info)` and `deriveAesKey(material, info)`
- HKDF params: SHA-256, zero-filled 32-byte salt (standard when no application salt), info from spec labels (`"plannotator:v1:room-auth"`, etc.)
- authKey/adminKey → HMAC-SHA-256 (`['sign', 'verify']`)
- eventKey/presenceKey → AES-256-GCM (`['encrypt', 'decrypt']`)

**Verifiers (HMAC):**
- `computeRoomVerifier(authKey, roomId)` → base64url string
- `computeAdminVerifier(adminKey, roomId)` → base64url string

**Proofs (HMAC with verifier as key):**
- `computeAuthProof(roomVerifier, roomId, clientId, challengeId, nonce)` → base64url
- `verifyAuthProof(...)` → boolean
- `computeAdminProof(adminVerifier, roomId, clientId, challengeId, nonce, command)` → base64url
- `verifyAdminProof(...)` → boolean

**Concatenation delimiter.** The spec now specifies null byte (`\0`) separators between HMAC input components (added to `specs/v1.md` as part of this slice). Without delimiters, `roomId="ab" + clientId="cd"` would produce the same bytes as `roomId="a" + clientId="bcd"`. All HMAC inputs use: `TextEncoder.encode(comp1 + '\0' + comp2 + '\0' + ...)`.

To use a verifier (which is HMAC output bytes) as a signing key for proofs: import via `crypto.subtle.importKey('raw', verifierBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])`.

**AES-256-GCM encrypt/decrypt:**
- `encryptPayload(key, plaintext)` → base64url(IV || ciphertext+tag)
- `decryptPayload(key, ciphertext)` → plaintext string
- Follow exact pattern from `packages/shared/crypto.ts:15-77`: 12-byte random IV, prepend to ciphertext, base64url encode.

**Channel convenience wrappers:**
- `encryptEventOp(eventKey, op)` / `decryptEventPayload(eventKey, ciphertext)`
- `encryptPresence(presenceKey, presence)` / `decryptPresence(presenceKey, ciphertext)`
- `encryptSnapshot(eventKey, snapshot)` / `decryptSnapshot(eventKey, ciphertext)`
- These `JSON.stringify` → `encryptPayload` and `decryptPayload` → `JSON.parse`.

### 5. `collab/ids.ts` — ID and Secret Generation

All use `crypto.getRandomValues()`. Import `bytesToBase64url` from `./encoding.ts`.

```ts
export function generateRoomId(): string       // 16 bytes (128 bits) → base64url
export function generateOpId(): string          // 16 bytes → base64url
export function generateClientId(): string      // 16 bytes → base64url
export function generateRoomSecret(): Uint8Array  // 32 bytes raw (for key derivation)
export function generateAdminSecret(): Uint8Array // 32 bytes raw
export function generateNonce(): string         // 32 bytes → base64url
export function generateChallengeId(): string   // "ch_" + 16 bytes base64url
```

Secrets return raw `Uint8Array` (not base64url) because `deriveRoomKeys()` takes bytes directly. The URL helper handles encoding for the fragment.

### 6. `collab/url.ts` — Client-Only URL Parsing

Module-level JSDoc: `@module CLIENT-ONLY — The Worker and Durable Object must NEVER import this module.`

```ts
export interface ParsedRoomUrl { roomId: string; roomSecret: Uint8Array }
export function parseRoomUrl(url: string): ParsedRoomUrl | null
export function buildRoomJoinUrl(roomId: string, roomSecret: Uint8Array, baseUrl?: string): string
```

- `parseRoomUrl`: uses `new URL(url)`, extracts pathname `/c/<roomId>`, reads fragment for `key=<base64url>`, decodes to bytes. Returns `null` on any failure.
- `buildRoomJoinUrl`: constructs `${baseUrl}/c/${roomId}#key=${bytesToBase64url(roomSecret)}`. Default baseUrl: `https://room.plannotator.ai`.
- Round-trip: `parseRoomUrl(buildRoomJoinUrl(id, secret))` must recover same id and secret bytes.

### 7. `collab/strip-images.ts` — Image Stripping

Generic approach (avoids importing `Annotation` from `@plannotator/ui`):

```ts
export function toRoomAnnotation<T extends { images?: unknown }>(annotation: T): Omit<T, 'images'>
export function toRoomAnnotations<T extends { images?: unknown }>(annotations: T[]): Omit<T, 'images'>[]
```

Destructure `{ images, ...rest }`, return `rest`. The generic means it works with `Annotation` at the call site without importing it here.

### 8. `collab/index.ts` — Server-Safe Barrel Export

Re-exports everything **except** the client-only URL helpers. This is what the Worker and Durable Object import.

```ts
export * from './types';
export * from './encoding';
export * from './canonical-json';
export * from './crypto';
export * from './ids';
export * from './strip-images';
// NOTE: ./url is intentionally NOT re-exported here — it is client-only.
// Browser and direct-agent clients should import from '@plannotator/shared/collab/client'.
```

### 9. `collab/client.ts` — Client Barrel Export

Re-exports the server-safe barrel plus the client-only URL helpers. This is what browsers and direct-agent clients import.

```ts
export * from './index';
export * from './url';
```

### 10. `packages/shared/package.json` — Add Exports

Add to the existing exports map:
```json
"./collab": "./collab/index.ts",
"./collab/client": "./collab/client.ts"
```

`@plannotator/shared/collab` is the server-safe import (types, crypto, ids, encoding, image stripping). `@plannotator/shared/collab/client` adds URL parsing for browser and direct-agent use.

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/package.json` | Add `"./collab": "./collab/index.ts"` and `"./collab/client": "./collab/client.ts"` to exports |
| `specs/v1.md` | Add null byte delimiter specification for HMAC concatenation (already applied) |

## Implementation Order

1. `encoding.ts` + test — zero dependencies, foundational
2. `canonical-json.ts` + test — zero dependencies
3. `types.ts` — zero dependencies, pure types
4. `ids.ts` + test — depends on encoding
5. `crypto.ts` + test — depends on encoding, canonical-json, types
6. `url.ts` + test — depends on encoding
7. `strip-images.ts` + test — zero dependencies
8. `index.ts` server-safe barrel + `client.ts` client barrel
9. `package.json` exports

Steps 1-3 can be done in parallel. Steps 4, 6, 7 in parallel after step 1.

## Test Plan

All tests use `bun:test` (`import { describe, expect, test } from "bun:test"`), matching existing patterns in `packages/shared/crypto.test.ts`.

**encoding.test.ts:** Round-trip encode/decode, empty input, large payloads, all 256 byte values. Test `base64urlToBytes` with valid unpadded inputs (lengths 2 and 3 mod 4), and verify length 1 mod 4 is rejected as malformed.

**canonical-json.test.ts:** Sorted keys, nested objects, arrays preserve order, undefined omitted, throws on NaN/Infinity/functions/symbols. **Known-output test vectors** — same input must always produce byte-identical output (this is security-critical for admin proof binding).

**crypto.test.ts:**
- HKDF determinism via observable outputs: same secret + same roomId → same roomVerifier; different secrets → different verifiers; different labels → different keys (eventKey can't decrypt presenceKey ciphertext)
- Auth proof: `computeAuthProof` + `verifyAuthProof` round-trip; wrong inputs reject
- Admin proof: round-trip; wrong command rejects; proof is bound to canonicalJson(command)
- AES-GCM: encrypt/decrypt round-trip; unique ciphertext per call (fresh IV); wrong key fails; tampered ciphertext fails
- Cross-key isolation: eventKey cannot decrypt presenceKey ciphertext
- Channel wrappers: `encryptSnapshot`/`decryptSnapshot` round-trip with real `RoomSnapshot`

**ids.test.ts:** Byte lengths (roomId ≥ 16 decoded, secrets = 32), uniqueness across calls, challengeId prefix.

**url.test.ts:** Valid URL parses correctly; missing fragment → null; wrong path → null; empty roomId → null; round-trip `parse(build(...))` recovers same values; custom baseUrl works.

**strip-images.test.ts:** Strips images field, preserves all other fields; annotation without images unchanged; batch works; output serializes without images key.

## Verification

```bash
bun test packages/shared/collab/
```

All tests pass. Existing runtime behavior is unchanged. The package exports cleanly from `@plannotator/shared/collab` (server-safe) and `@plannotator/shared/collab/client` (browser/agent).

## Protocol Decisions to Document in Code

1. **HKDF salt**: zero-filled 32 bytes (standard when no application-specific salt)
2. **HMAC concatenation**: null byte (`\0`) separators between components to prevent ambiguity — now specified in `specs/v1.md`
3. **AES-GCM IV**: 12 bytes, random per encryption, prepended to ciphertext
4. **Base64url decoding**: normalize padding before `atob` for cross-runtime safety
5. **RoomAnnotation**: structural copy of Annotation minus images — must be manually updated when Annotation gains new fields
6. **RoomState is server-only**: defined in Slice 2's `apps/room-service`, not exported from the shared collab barrel
7. **URL parsing is client-only**: separate `client.ts` barrel; `index.ts` (server-safe) does not re-export `url.ts`
8. **RoomAnnotation.type**: string literal union `"DELETION" | "COMMENT" | "GLOBAL_COMMENT"`, not `string`
