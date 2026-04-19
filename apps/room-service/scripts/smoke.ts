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
  computeAdminProof,
  encryptSnapshot,
  encryptPayload,
  encryptPresence,
  generateRoomId,
  generateRoomSecret,
  generateAdminSecret,
  generateOpId,
} from '@plannotator/shared/collab/client';

import type {
  CreateRoomRequest,
  CreateRoomResponse,
  AdminChallenge,
  AdminCommand,
  RoomSnapshot,
  RoomTransportMessage,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Messages received on the socket — includes transport messages and admin challenges. */
type SmokeMessage = RoomTransportMessage | AdminChallenge;

interface AuthedSocket {
  ws: WebSocket;
  clientId: string;
  messages: SmokeMessage[];
  closed: boolean;
}

/** Connect, authenticate, and return a ready socket that collects messages. */
async function connectAndAuth(
  roomId: string,
  roomVerifier: string,
  lastSeq?: number,
): Promise<AuthedSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);
    // clientId is now assigned by the server in the auth.challenge message;
    // we adopt it here instead of self-generating (see PresenceImpersonation
    // fix). Placeholder until challenge arrives.
    let clientId = '';
    const result: AuthedSocket = { ws, clientId: '', messages: [], closed: false };
    let authed = false;

    const timeout = setTimeout(() => {
      if (!authed) { ws.close(); reject(new Error('Auth timeout')); }
    }, 10_000);

    ws.onmessage = async (event) => {
      const msg = JSON.parse(String(event.data));

      if (!authed && msg.type === 'auth.challenge') {
        clientId = msg.clientId;
        result.clientId = clientId;
        const proof = await computeAuthProof(roomVerifier, roomId, clientId, msg.challengeId, msg.nonce);
        ws.send(JSON.stringify({ type: 'auth.response', challengeId: msg.challengeId, clientId, proof, lastSeq }));
        return;
      }

      if (!authed && msg.type === 'auth.accepted') {
        authed = true;
        clearTimeout(timeout);
        // Collect subsequent messages
        ws.onmessage = (e) => {
          result.messages.push(JSON.parse(String(e.data)));
        };
        resolve(result);
        return;
      }
    };

    ws.onclose = () => { result.closed = true; };
    ws.onerror = () => { if (!authed) reject(new Error('WebSocket error')); };
  });
}

/** Wait briefly for messages to arrive. */
function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  console.log(`\nSmoke testing room-service at ${BASE_URL}\n`);

  // -----------------------------------------------------------------------
  // 1. Health check
  // -----------------------------------------------------------------------
  console.log('1. Health check');
  const healthRes = await fetch(`${BASE_URL}/health`);
  assert(healthRes.ok, 'GET /health returns 200');

  // -----------------------------------------------------------------------
  // 2. Create a room
  // -----------------------------------------------------------------------
  console.log('\n2. Room creation');
  const roomId = generateRoomId();
  const roomSecret = generateRoomSecret();
  const adminSecret = generateAdminSecret();

  const { authKey, eventKey, presenceKey } = await deriveRoomKeys(roomSecret);
  const adminKey = await deriveAdminKey(adminSecret);

  const roomVerifier = await computeRoomVerifier(authKey, roomId);
  const adminVerifier = await computeAdminVerifier(adminKey, roomId);

  const snapshot: RoomSnapshot = { versionId: 'v1', planMarkdown: '# Smoke Test', annotations: [] };
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
  assert(!createResponseBody.joinUrl.includes('#'), 'joinUrl has no fragment');

  // -----------------------------------------------------------------------
  // 3. Duplicate room creation → 409
  // -----------------------------------------------------------------------
  console.log('\n3. Duplicate room creation');
  const dupRes = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  assert(dupRes.status === 409, 'Duplicate returns 409');

  // -----------------------------------------------------------------------
  // 4. Fresh join receives snapshot
  // -----------------------------------------------------------------------
  console.log('\n4. Fresh join receives snapshot');
  const client1 = await connectAndAuth(roomId, roomVerifier);
  await wait(200);
  const snapshots1 = client1.messages.filter(m => m.type === 'room.snapshot');
  assert(snapshots1.length === 1, 'Client1 received room.snapshot on join');

  // -----------------------------------------------------------------------
  // 5. Two clients — event echo + broadcast
  // -----------------------------------------------------------------------
  console.log('\n5. Event sequencing + echo');
  const client2 = await connectAndAuth(roomId, roomVerifier);
  await wait(200);
  // Clear join messages
  client1.messages.length = 0;
  client2.messages.length = 0;

  // Client1 sends an event. Use a real annotation — empty annotation.add is
  // rejected by conforming clients (no-op would burn a durable seq).
  const realAnnotation = {
    id: 'smoke-ann-1',
    blockId: 'block-1',
    startOffset: 0,
    endOffset: 5,
    type: 'COMMENT' as const,
    originalText: 'hello',
    createdA: Date.now(),
    text: 'smoke test annotation',
  };
  const eventCiphertext = await encryptPayload(eventKey, JSON.stringify({ type: 'annotation.add', annotations: [realAnnotation] }));
  client1.ws.send(JSON.stringify({
    clientId: client1.clientId,
    opId: generateOpId(),
    channel: 'event',
    ciphertext: eventCiphertext,
  }));
  await wait(500);

  const client1Events = client1.messages.filter(m => m.type === 'room.event');
  const client2Events = client2.messages.filter(m => m.type === 'room.event');
  assert(client1Events.length === 1, 'Sender receives echo (room.event)');
  assert(client2Events.length === 1, 'Other client receives room.event');

  // -----------------------------------------------------------------------
  // 6. Presence relay — others only
  // -----------------------------------------------------------------------
  console.log('\n6. Presence relay');
  client1.messages.length = 0;
  client2.messages.length = 0;

  // Presence MUST be encrypted with presenceKey (not eventKey) and carry a
  // valid PresenceState shape — conforming clients reject malformed presence.
  const validPresence = {
    user: { id: 'smoke-u1', name: 'smoke', color: '#f00' },
    cursor: null,
  };
  const presenceCiphertext = await encryptPresence(presenceKey, validPresence);
  client1.ws.send(JSON.stringify({
    clientId: client1.clientId,
    opId: generateOpId(),
    channel: 'presence',
    ciphertext: presenceCiphertext,
  }));
  await wait(300);

  const client1Presence = client1.messages.filter(m => m.type === 'room.presence');
  const client2Presence = client2.messages.filter(m => m.type === 'room.presence');
  assert(client1Presence.length === 0, 'Sender does NOT receive own presence');
  assert(client2Presence.length === 1, 'Other client receives room.presence');

  // -----------------------------------------------------------------------
  // 7. Reconnect replay
  // -----------------------------------------------------------------------
  console.log('\n7. Reconnect replay');
  client2.ws.close();
  await wait(200);

  // Client1 sends another event while client2 is disconnected
  client1.ws.send(JSON.stringify({
    clientId: client1.clientId,
    opId: generateOpId(),
    channel: 'event',
    ciphertext: eventCiphertext,
  }));
  await wait(300);

  // Client2 reconnects with lastSeq from the first event (seq 1)
  const client2b = await connectAndAuth(roomId, roomVerifier, 1);
  await wait(500);

  const replayedEvents = client2b.messages.filter(m => m.type === 'room.event');
  assert(replayedEvents.length === 1, 'Reconnect replayed 1 missed event (seq 2)');
  if (replayedEvents.length > 0 && replayedEvents[0].type === 'room.event') {
    assert(replayedEvents[0].seq === 2, 'Replayed event has seq 2');
  }

  // -----------------------------------------------------------------------
  // 8. Admin lock
  // -----------------------------------------------------------------------
  console.log('\n8. Admin lock');
  client1.messages.length = 0;
  client2b.messages.length = 0;

  // Request admin challenge
  client1.ws.send(JSON.stringify({ type: 'admin.challenge.request' }));
  await wait(300);
  const adminChallengeMsg = client1.messages.find(m => m.type === 'admin.challenge') as AdminChallenge | undefined;
  assert(!!adminChallengeMsg, 'Received admin.challenge');

  if (adminChallengeMsg) {
    const lockCmd: AdminCommand = { type: 'room.lock' };
    const adminProof = await computeAdminProof(
      adminVerifier, roomId, client1.clientId,
      adminChallengeMsg.challengeId, adminChallengeMsg.nonce, lockCmd,
    );
    client1.ws.send(JSON.stringify({
      type: 'admin.command',
      challengeId: adminChallengeMsg.challengeId,
      clientId: client1.clientId,
      command: lockCmd,
      adminProof,
    }));
    await wait(300);

    const statusMsgs1 = client1.messages.filter(m => m.type === 'room.status');
    const statusMsgs2 = client2b.messages.filter(m => m.type === 'room.status');
    assert(statusMsgs1.some(m => m.type === 'room.status' && m.status === 'locked'), 'Client1 receives room.status: locked');
    assert(statusMsgs2.some(m => m.type === 'room.status' && m.status === 'locked'), 'Client2 receives room.status: locked');
  }

  // -----------------------------------------------------------------------
  // 9. Locked room rejects events
  // -----------------------------------------------------------------------
  console.log('\n9. Locked room rejects events');
  client1.messages.length = 0;

  client1.ws.send(JSON.stringify({
    clientId: client1.clientId,
    opId: generateOpId(),
    channel: 'event',
    ciphertext: eventCiphertext,
  }));
  await wait(300);

  const errorMsgs = client1.messages.filter(m => m.type === 'room.error');
  assert(errorMsgs.length > 0, 'Locked room sends room.error for event');
  assert(!client1.closed, 'Socket stays open after room.error');

  // -----------------------------------------------------------------------
  // 10. Admin unlock
  // -----------------------------------------------------------------------
  console.log('\n10. Admin unlock');
  client1.messages.length = 0;
  client2b.messages.length = 0;

  client1.ws.send(JSON.stringify({ type: 'admin.challenge.request' }));
  await wait(300);
  const unlockChallenge = client1.messages.find(m => m.type === 'admin.challenge') as AdminChallenge | undefined;

  if (unlockChallenge) {
    const unlockCmd: AdminCommand = { type: 'room.unlock' };
    const unlockProof = await computeAdminProof(
      adminVerifier, roomId, client1.clientId,
      unlockChallenge.challengeId, unlockChallenge.nonce, unlockCmd,
    );
    client1.ws.send(JSON.stringify({
      type: 'admin.command',
      challengeId: unlockChallenge.challengeId,
      clientId: client1.clientId,
      command: unlockCmd,
      adminProof: unlockProof,
    }));
    await wait(300);

    assert(client1.messages.some(m => m.type === 'room.status' && m.status === 'active'), 'Unlock broadcasts room.status: active');
  }

  // -----------------------------------------------------------------------
  // 11. Admin delete
  // -----------------------------------------------------------------------
  console.log('\n11. Admin delete');
  client1.messages.length = 0;

  client1.ws.send(JSON.stringify({ type: 'admin.challenge.request' }));
  await wait(300);
  const deleteChallenge = client1.messages.find(m => m.type === 'admin.challenge') as AdminChallenge | undefined;

  if (deleteChallenge) {
    const deleteCmd: AdminCommand = { type: 'room.delete' };
    const deleteProof = await computeAdminProof(
      adminVerifier, roomId, client1.clientId,
      deleteChallenge.challengeId, deleteChallenge.nonce, deleteCmd,
    );
    client1.ws.send(JSON.stringify({
      type: 'admin.command',
      challengeId: deleteChallenge.challengeId,
      clientId: client1.clientId,
      command: deleteCmd,
      adminProof: deleteProof,
    }));
    await wait(500);

    assert(client1.closed, 'Client1 socket closed after delete');
    assert(client2b.closed, 'Client2 socket closed after delete');
  }

  // -----------------------------------------------------------------------
  // 12. Deleted room rejects new joins
  // -----------------------------------------------------------------------
  console.log('\n12. Deleted room rejects new joins');
  try {
    const client3 = await connectAndAuth(roomId, roomVerifier);
    client3.ws.close();
    assert(false, 'Should not authenticate to deleted room');
  } catch {
    assert(true, 'Deleted room rejects new WebSocket join');
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
