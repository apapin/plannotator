/**
 * Smoke test for room-service against a running wrangler dev instance.
 *
 * Usage:
 *   cd apps/room-service && wrangler dev    # in one terminal
 *   bun run scripts/smoke.ts                # in another terminal
 *
 * This acts as an external client: it imports from @plannotator/shared/collab/client
 * to simulate browser/agent auth flows. Server runtime code must NOT do this.
 *
 * Exits 0 on success, non-zero on failure.
 */

import {
  deriveRoomKeys,
  deriveAdminKey,
  computeRoomVerifier,
  computeAdminVerifier,
  computeAuthProof,
  encryptSnapshot,
  generateRoomId,
  generateRoomSecret,
  generateAdminSecret,
  generateClientId,
} from '@plannotator/shared/collab/client';

import type {
  CreateRoomRequest,
  CreateRoomResponse,
  AuthChallenge,
  AuthAccepted,
  RoomSnapshot,
} from '@plannotator/shared/collab';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:8787';
const WS_BASE = BASE_URL.replace(/^http/, 'ws');

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

async function run(): Promise<void> {
  console.log(`\nSmoke testing room-service at ${BASE_URL}\n`);

  // -----------------------------------------------------------------------
  // 1. Health check
  // -----------------------------------------------------------------------
  console.log('1. Health check');
  const healthRes = await fetch(`${BASE_URL}/health`);
  assert(healthRes.ok, 'GET /health returns 200');
  const healthBody = await healthRes.json() as { ok: boolean };
  assert(healthBody.ok === true, 'Response body is { ok: true }');

  // -----------------------------------------------------------------------
  // 2. Create a room
  // -----------------------------------------------------------------------
  console.log('\n2. Room creation');
  const roomId = generateRoomId();
  const roomSecret = generateRoomSecret();
  const adminSecret = generateAdminSecret();

  const { authKey, eventKey } = await deriveRoomKeys(roomSecret);
  const adminKey = await deriveAdminKey(adminSecret);

  const roomVerifier = await computeRoomVerifier(authKey, roomId);
  const adminVerifier = await computeAdminVerifier(adminKey, roomId);

  const snapshot: RoomSnapshot = {
    versionId: 'v1',
    planMarkdown: '# Smoke Test Plan\n\nThis is a test.',
    annotations: [],
  };
  const snapshotCiphertext = await encryptSnapshot(eventKey, snapshot);

  const createBody: CreateRoomRequest = {
    roomId,
    roomVerifier,
    adminVerifier,
    initialSnapshotCiphertext: snapshotCiphertext,
  };

  const createRes = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  assert(createRes.status === 201, 'POST /api/rooms returns 201');

  const createResponseBody = await createRes.json() as CreateRoomResponse;
  assert(createResponseBody.roomId === roomId, 'Response contains roomId');
  assert(createResponseBody.status === 'active', 'Status is active');
  assert(createResponseBody.seq === 0, 'seq is 0');
  assert(!createResponseBody.joinUrl.includes('#'), 'joinUrl has no fragment');
  assert(!createResponseBody.websocketUrl.includes('?'), 'websocketUrl has no query params');

  // -----------------------------------------------------------------------
  // 3. Duplicate room creation → 409
  // -----------------------------------------------------------------------
  console.log('\n3. Duplicate room creation');
  const dupRes = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  assert(dupRes.status === 409, 'Duplicate POST /api/rooms returns 409');

  // -----------------------------------------------------------------------
  // 4. WebSocket auth — valid proof
  // -----------------------------------------------------------------------
  console.log('\n4. WebSocket auth (valid proof)');
  const validAuth = await testWebSocketAuth(roomId, roomVerifier, true);
  assert(validAuth, 'Valid proof → auth.accepted');

  // -----------------------------------------------------------------------
  // 5. WebSocket auth — invalid proof
  // -----------------------------------------------------------------------
  console.log('\n5. WebSocket auth (invalid proof)');
  const invalidAuth = await testWebSocketAuth(roomId, roomVerifier, false);
  assert(!invalidAuth, 'Invalid proof → connection closed');

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

async function testWebSocketAuth(
  roomId: string,
  roomVerifier: string,
  useValidProof: boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(false);
      }
    }, 10_000);

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(String(event.data));

        if (msg.type === 'auth.challenge') {
          const clientId = generateClientId();
          let proof: string;

          if (useValidProof) {
            proof = await computeAuthProof(
              roomVerifier,
              roomId,
              clientId,
              msg.challengeId,
              msg.nonce,
            );
          } else {
            proof = 'invalid-proof-garbage';
          }

          ws.send(JSON.stringify({
            type: 'auth.response',
            challengeId: msg.challengeId,
            clientId,
            proof,
          }));
        }

        if (msg.type === 'auth.accepted') {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        }
      } catch (e) {
        console.error('  WebSocket message error:', e);
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    };
  });
}

run().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
