/**
 * Plannotator Room Durable Object.
 *
 * Uses Cloudflare Workers WebSocket Hibernation API.
 * All per-connection state lives in WebSocket attachments
 * (survives DO hibernation).
 *
 * Implements: room creation, WebSocket auth, event sequencing,
 * presence relay, reconnect replay, admin commands, lifecycle enforcement.
 *
 * Zero-knowledge: stores/relays ciphertext only. Never needs roomSecret,
 * eventKey, presenceKey, or plaintext content.
 */

import type {
  AuthChallenge,
  AuthResponse,
  AuthAccepted,
  AdminChallenge,
  AdminCommandEnvelope,
  CreateRoomRequest,
  CreateRoomResponse,
  ServerEnvelope,
  SequencedEnvelope,
  RoomTransportMessage,
} from '@plannotator/shared/collab';
import { verifyAuthProof, verifyAdminProof, generateChallengeId, generateNonce } from '@plannotator/shared/collab';
import { DurableObject } from 'cloudflare:workers';
import type { Env, RoomDurableState, WebSocketAttachment } from './types';
import { clampExpiryDays, hasRoomExpired, validateServerEnvelope, validateAdminCommandEnvelope, isValidationError } from './validation';
import type { ValidationError } from './validation';
import { safeLog } from './log';

const CHALLENGE_TTL_MS = 30_000;
const ADMIN_CHALLENGE_TTL_MS = 30_000;
const DELETE_BATCH_SIZE = 128; // Cloudflare DO storage.delete() max keys per call

// WebSocket close codes
const WS_CLOSE_AUTH_REQUIRED = 4001;
const WS_CLOSE_UNKNOWN_CHALLENGE = 4002;
const WS_CLOSE_CHALLENGE_EXPIRED = 4003;
const WS_CLOSE_INVALID_PROOF = 4004;
const WS_CLOSE_PROTOCOL_ERROR = 4005;
const WS_CLOSE_ROOM_UNAVAILABLE = 4006;

/** Zero-pad a seq number to 10 digits for lexicographic storage ordering. */
function padSeq(seq: number): string {
  return String(seq).padStart(10, '0');
}

export class RoomDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/create' && request.method === 'POST') {
      return this.handleCreate(request);
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Room Creation
  // ---------------------------------------------------------------------------

  private async handleCreate(request: Request): Promise<Response> {
    let body: CreateRoomRequest;
    try {
      body = await request.json() as CreateRoomRequest;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const existing = await this.ctx.storage.get<RoomDurableState>('room');
    if (existing?.status === 'deleted') {
      return Response.json({ error: 'Room deleted' }, { status: 410 });
    }
    if (existing?.status === 'expired' || (existing && hasRoomExpired(existing.expiresAt))) {
      await this.markExpired(existing);
      return Response.json({ error: 'Room expired' }, { status: 410 });
    }
    if (existing) {
      return Response.json({ error: 'Room already exists' }, { status: 409 });
    }

    const expiryDays = clampExpiryDays(body.expiresInDays);

    const state: RoomDurableState = {
      roomId: body.roomId,
      status: 'active',
      roomVerifier: body.roomVerifier,
      adminVerifier: body.adminVerifier,
      seq: 0,
      earliestRetainedSeq: 1,
      snapshotCiphertext: body.initialSnapshotCiphertext,
      snapshotSeq: 0,
      expiresAt: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
    };

    try {
      await this.ctx.storage.put('room', state);
    } catch (e) {
      safeLog('room:create-storage-error', { roomId: body.roomId, error: String(e) });
      return Response.json({ error: 'Failed to store room state' }, { status: 507 });
    }

    const base = new URL(this.env.BASE_URL || 'https://room.plannotator.ai');
    const wsScheme = base.protocol === 'https:' ? 'wss:' : 'ws:';

    const response: CreateRoomResponse = {
      roomId: body.roomId,
      status: 'active',
      seq: 0,
      snapshotSeq: 0,
      joinUrl: `${base.origin}/c/${body.roomId}`,
      websocketUrl: `${wsScheme}//${base.host}/ws/${body.roomId}`,
    };

    safeLog('room:created', { roomId: body.roomId, expiryDays });
    return Response.json(response, { status: 201 });
  }

  // ---------------------------------------------------------------------------
  // WebSocket Upgrade
  // ---------------------------------------------------------------------------

  private async handleWebSocketUpgrade(_request: Request): Promise<Response> {
    const roomState = await this.ctx.storage.get<RoomDurableState>('room');
    if (!roomState) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }
    if (roomState.status === 'deleted') {
      return Response.json({ error: 'Room deleted' }, { status: 410 });
    }
    if (roomState.status === 'expired' || hasRoomExpired(roomState.expiresAt)) {
      await this.markExpired(roomState);
      return Response.json({ error: 'Room expired' }, { status: 410 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;

    this.ctx.acceptWebSocket(server);

    const attachment: WebSocketAttachment = {
      authenticated: false,
      roomId: roomState.roomId,
      challengeId,
      nonce,
      expiresAt,
    };
    server.serializeAttachment(attachment);

    const challenge: AuthChallenge = {
      type: 'auth.challenge',
      challengeId,
      nonce,
      expiresAt,
    };
    server.send(JSON.stringify(challenge));

    safeLog('ws:challenge-sent', { roomId: roomState.roomId, challengeId });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------------------
  // WebSocket Message Handler (Hibernation API)
  // ---------------------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const meta = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!meta) {
      ws.close(WS_CLOSE_AUTH_REQUIRED, 'No connection state');
      return;
    }

    let msg: Record<string, unknown>;
    try {
      const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
      msg = JSON.parse(raw);
    } catch {
      ws.close(WS_CLOSE_PROTOCOL_ERROR, 'Invalid message format');
      return;
    }

    // Pre-auth: only accept auth.response
    if (!meta.authenticated) {
      if (msg.type !== 'auth.response') {
        ws.close(WS_CLOSE_AUTH_REQUIRED, 'Authentication required');
        return;
      }
      if (
        typeof msg.challengeId !== 'string' || !msg.challengeId ||
        typeof msg.clientId !== 'string' || !msg.clientId ||
        typeof msg.proof !== 'string' || !msg.proof
      ) {
        ws.close(WS_CLOSE_PROTOCOL_ERROR, 'Malformed auth response');
        return;
      }
      // Validate lastSeq as non-negative integer if provided
      let lastSeq: number | undefined;
      if (msg.lastSeq !== undefined) {
        if (typeof msg.lastSeq !== 'number' || !Number.isInteger(msg.lastSeq) || msg.lastSeq < 0) {
          ws.close(WS_CLOSE_PROTOCOL_ERROR, 'lastSeq must be a non-negative integer');
          return;
        }
        lastSeq = msg.lastSeq;
      }
      const authResponse: AuthResponse = {
        type: 'auth.response',
        challengeId: msg.challengeId as string,
        clientId: msg.clientId as string,
        proof: msg.proof as string,
        lastSeq,
      };
      await this.handleAuthResponse(ws, meta, authResponse);
      return;
    }

    // Post-auth: dispatch by message type
    await this.handlePostAuthMessage(ws, meta, msg);
  }

  // ---------------------------------------------------------------------------
  // Post-Auth Message Dispatch
  // ---------------------------------------------------------------------------

  private async handlePostAuthMessage(
    ws: WebSocket,
    meta: Extract<WebSocketAttachment, { authenticated: true }>,
    msg: Record<string, unknown>,
  ): Promise<void> {
    // Admin challenge request
    if (msg.type === 'admin.challenge.request') {
      await this.handleAdminChallengeRequest(ws, meta);
      return;
    }

    // Admin command
    if (msg.type === 'admin.command') {
      await this.handleAdminCommand(ws, meta, msg);
      return;
    }

    // ServerEnvelope — detect via channel field (no type field)
    if (typeof msg.channel === 'string' && (msg.channel === 'event' || msg.channel === 'presence')) {
      await this.handleServerEnvelope(ws, meta, msg);
      return;
    }

    ws.close(WS_CLOSE_PROTOCOL_ERROR, 'Unknown message type');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Check (shared by event, presence, admin paths)
  // ---------------------------------------------------------------------------

  /**
   * Check room lifecycle state. Returns roomState if usable, or null if terminal.
   * Closes the socket and handles expiry transition for terminal rooms.
   */
  private async checkRoomLifecycle(
    ws: WebSocket,
    roomId: string,
  ): Promise<RoomDurableState | null> {
    const roomState = await this.ctx.storage.get<RoomDurableState>('room');
    if (!roomState) {
      ws.close(WS_CLOSE_ROOM_UNAVAILABLE, 'Room unavailable');
      return null;
    }
    if (roomState.status === 'deleted') {
      ws.close(WS_CLOSE_ROOM_UNAVAILABLE, 'Room deleted');
      return null;
    }
    if (roomState.status === 'expired') {
      ws.close(WS_CLOSE_ROOM_UNAVAILABLE, 'Room expired');
      return null;
    }
    // Lazy expiry: active/locked room past retention deadline
    if (hasRoomExpired(roomState.expiresAt)) {
      await this.markExpired(roomState, ws);
      ws.close(WS_CLOSE_ROOM_UNAVAILABLE, 'Room expired');
      return null;
    }
    return roomState;
  }

  // ---------------------------------------------------------------------------
  // Event Sequencing & Presence Relay
  // ---------------------------------------------------------------------------

  private async handleServerEnvelope(
    ws: WebSocket,
    meta: Extract<WebSocketAttachment, { authenticated: true }>,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const validated = validateServerEnvelope(msg);
    if (isValidationError(validated)) {
      this.sendError(ws, 'validation_error', (validated as ValidationError).error);
      return;
    }
    const envelope: ServerEnvelope = {
      ...validated as ServerEnvelope,
      clientId: meta.clientId, // Override — prevent spoofing
    };

    const roomState = await this.checkRoomLifecycle(ws, meta.roomId);
    if (!roomState) return;

    if (envelope.channel === 'event') {
      // Locked rooms reject event mutations (annotation ops)
      if (roomState.status === 'locked') {
        this.sendError(ws, 'room_locked', 'Room is locked — annotation operations are not allowed');
        return;
      }

      // Sequence the event
      roomState.seq++;
      const sequenced: SequencedEnvelope = {
        seq: roomState.seq,
        receivedAt: Date.now(),
        envelope,
      };

      // Atomic write: event key + room metadata in one put
      await this.ctx.storage.put({
        [`event:${padSeq(roomState.seq)}`]: sequenced,
        'room': roomState,
      } as Record<string, unknown>);

      // Broadcast to ALL (including sender for lastSeq advancement)
      const transport: RoomTransportMessage = {
        type: 'room.event',
        seq: sequenced.seq,
        receivedAt: sequenced.receivedAt,
        envelope: sequenced.envelope,
      };
      this.broadcastToAll(transport);

      safeLog('room:event-sequenced', { roomId: roomState.roomId, seq: roomState.seq, clientId: meta.clientId });
    } else {
      // Presence — allowed in active and locked rooms
      const transport: RoomTransportMessage = {
        type: 'room.presence',
        envelope,
      };
      this.broadcastToOthers(ws, transport);
    }
  }

  // ---------------------------------------------------------------------------
  // Auth Response + Reconnect Replay
  // ---------------------------------------------------------------------------

  private async handleAuthResponse(
    ws: WebSocket,
    meta: Extract<WebSocketAttachment, { authenticated: false }>,
    authResponse: AuthResponse,
  ): Promise<void> {
    if (authResponse.challengeId !== meta.challengeId) {
      safeLog('ws:auth-rejected', { reason: 'unknown-challenge', roomId: meta.roomId });
      ws.close(WS_CLOSE_UNKNOWN_CHALLENGE, 'Unknown challenge');
      return;
    }

    if (Date.now() > meta.expiresAt) {
      safeLog('ws:auth-rejected', { reason: 'expired', roomId: meta.roomId });
      ws.close(WS_CLOSE_CHALLENGE_EXPIRED, 'Challenge expired');
      return;
    }

    const roomState = await this.ctx.storage.get<RoomDurableState>('room');
    if (!roomState) {
      ws.close(WS_CLOSE_ROOM_UNAVAILABLE, 'Room unavailable');
      return;
    }
    if (roomState.status === 'deleted') {
      ws.close(WS_CLOSE_ROOM_UNAVAILABLE, 'Room deleted');
      return;
    }
    if (roomState.status === 'expired' || hasRoomExpired(roomState.expiresAt)) {
      await this.markExpired(roomState, ws);
      ws.close(WS_CLOSE_ROOM_UNAVAILABLE, 'Room expired');
      return;
    }

    const valid = await verifyAuthProof(
      roomState.roomVerifier,
      meta.roomId,
      authResponse.clientId,
      meta.challengeId,
      meta.nonce,
      authResponse.proof,
    );

    if (!valid) {
      safeLog('ws:auth-rejected', { reason: 'invalid-proof', roomId: meta.roomId });
      ws.close(WS_CLOSE_INVALID_PROOF, 'Invalid proof');
      return;
    }

    // Auth successful — update attachment
    const authenticatedMeta: WebSocketAttachment = {
      authenticated: true,
      roomId: meta.roomId,
      clientId: authResponse.clientId,
      authenticatedAt: Date.now(),
    };
    ws.serializeAttachment(authenticatedMeta);

    // Send auth.accepted
    const accepted: AuthAccepted = {
      type: 'auth.accepted',
      roomStatus: roomState.status,
      seq: roomState.seq,
      snapshotSeq: roomState.snapshotSeq,
      snapshotAvailable: !!roomState.snapshotCiphertext,
    };
    ws.send(JSON.stringify(accepted));

    // Reconnect replay
    await this.replayEvents(ws, roomState, authResponse.lastSeq);

    safeLog('ws:authenticated', { roomId: meta.roomId, clientId: authResponse.clientId, lastSeq: authResponse.lastSeq });
  }

  private async replayEvents(
    ws: WebSocket,
    roomState: RoomDurableState,
    lastSeq: number | undefined,
  ): Promise<void> {
    // Determine replay strategy
    let sendSnapshot = false;
    let replayFrom: number;

    if (lastSeq === undefined) {
      // Fresh join — send snapshot + all events
      sendSnapshot = true;
      replayFrom = (roomState.snapshotSeq ?? 0) + 1;
    } else if (lastSeq > roomState.seq) {
      // Future claim — anomaly, fall back to snapshot
      sendSnapshot = true;
      replayFrom = (roomState.snapshotSeq ?? 0) + 1;
      safeLog('ws:replay-anomaly', { roomId: roomState.roomId, lastSeq, currentSeq: roomState.seq });
    } else if (lastSeq === roomState.seq) {
      // Fully caught up — still send snapshot if seq is 0 (fresh room, no events yet)
      if (roomState.seq === 0 && roomState.snapshotCiphertext) {
        const snapshotMsg: RoomTransportMessage = {
          type: 'room.snapshot',
          snapshotSeq: roomState.snapshotSeq ?? 0,
          snapshotCiphertext: roomState.snapshotCiphertext,
        };
        ws.send(JSON.stringify(snapshotMsg));
      }
      return;
    } else {
      // Check if we can replay incrementally
      const nextNeededSeq = lastSeq + 1;
      // In V1 earliestRetainedSeq stays 1 because there is no compaction.
      // This branch becomes active once future compaction advances it.
      if (nextNeededSeq < roomState.earliestRetainedSeq) {
        // Too old — need snapshot fallback
        sendSnapshot = true;
        replayFrom = (roomState.snapshotSeq ?? 0) + 1;
      } else {
        // Can replay from retained log
        replayFrom = nextNeededSeq;
      }
    }

    // Send snapshot if needed
    if (sendSnapshot && roomState.snapshotCiphertext) {
      const snapshotMsg: RoomTransportMessage = {
        type: 'room.snapshot',
        snapshotSeq: roomState.snapshotSeq ?? 0,
        snapshotCiphertext: roomState.snapshotCiphertext,
      };
      ws.send(JSON.stringify(snapshotMsg));
    }

    // Replay events from storage (if any exist)
    if (roomState.seq > 0 && replayFrom <= roomState.seq) {
      const startKey = `event:${padSeq(replayFrom)}`;
      const events = await this.ctx.storage.list<SequencedEnvelope>({
        prefix: 'event:',
        start: startKey,
      });
      for (const [, sequenced] of events) {
        const transport: RoomTransportMessage = {
          type: 'room.event',
          seq: sequenced.seq,
          receivedAt: sequenced.receivedAt,
          envelope: sequenced.envelope,
        };
        ws.send(JSON.stringify(transport));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Admin Challenge-Response
  // ---------------------------------------------------------------------------

  private async handleAdminChallengeRequest(
    ws: WebSocket,
    meta: Extract<WebSocketAttachment, { authenticated: true }>,
  ): Promise<void> {
    // Lifecycle check — reject for terminal rooms
    const roomState = await this.checkRoomLifecycle(ws, meta.roomId);
    if (!roomState) return;

    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const expiresAt = Date.now() + ADMIN_CHALLENGE_TTL_MS;

    // Store in attachment (survives hibernation)
    const updatedMeta: WebSocketAttachment = {
      ...meta,
      pendingAdminChallenge: { challengeId, nonce, expiresAt },
    };
    ws.serializeAttachment(updatedMeta);

    const challenge: AdminChallenge = {
      type: 'admin.challenge',
      challengeId,
      nonce,
      expiresAt,
    };
    ws.send(JSON.stringify(challenge));

    safeLog('admin:challenge-sent', { roomId: meta.roomId, clientId: meta.clientId, challengeId });
  }

  private async handleAdminCommand(
    ws: WebSocket,
    meta: Extract<WebSocketAttachment, { authenticated: true }>,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const validated = validateAdminCommandEnvelope(msg);
    if (isValidationError(validated)) {
      this.sendError(ws, 'validation_error', (validated as ValidationError).error);
      return;
    }
    const cmdEnvelope = validated as AdminCommandEnvelope;

    // Reject cross-connection clientId spoofing
    if (cmdEnvelope.clientId !== meta.clientId) {
      this.sendError(ws, 'client_id_mismatch', 'clientId does not match authenticated connection');
      return;
    }

    // Check pending admin challenge
    if (!meta.pendingAdminChallenge) {
      this.sendError(ws, 'no_admin_challenge', 'Request an admin challenge first');
      return;
    }
    if (cmdEnvelope.challengeId !== meta.pendingAdminChallenge.challengeId) {
      this.sendError(ws, 'unknown_admin_challenge', 'Challenge ID does not match');
      return;
    }

    // Save challenge data before clearing
    const { challengeId, nonce, expiresAt } = meta.pendingAdminChallenge;

    // Clear challenge from attachment (single-use) — serialize immediately
    const { pendingAdminChallenge: _, ...cleanMeta } = meta;
    ws.serializeAttachment(cleanMeta);

    // Check expiry
    if (Date.now() > expiresAt) {
      this.sendError(ws, 'admin_challenge_expired', 'Admin challenge expired');
      return;
    }

    // Lifecycle check — reject for terminal rooms
    const roomState = await this.checkRoomLifecycle(ws, meta.roomId);
    if (!roomState) return;

    // Verify admin proof
    const valid = await verifyAdminProof(
      roomState.adminVerifier,
      meta.roomId,
      meta.clientId,
      challengeId,
      nonce,
      cmdEnvelope.command,
      cmdEnvelope.adminProof,
    );

    if (!valid) {
      safeLog('admin:proof-rejected', { roomId: meta.roomId, clientId: meta.clientId });
      this.sendError(ws, 'invalid_admin_proof', 'Admin proof verification failed');
      return;
    }

    // Apply command
    switch (cmdEnvelope.command.type) {
      case 'room.lock':
        await this.applyLock(ws, roomState, cmdEnvelope.command);
        break;
      case 'room.unlock':
        await this.applyUnlock(ws, roomState);
        break;
      case 'room.delete':
        await this.applyDelete(ws, roomState);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Admin Command Execution
  // ---------------------------------------------------------------------------

  private async applyLock(
    ws: WebSocket,
    roomState: RoomDurableState,
    command: Extract<AdminCommandEnvelope['command'], { type: 'room.lock' }>,
  ): Promise<void> {
    if (roomState.status !== 'active') {
      this.sendError(ws, 'invalid_state', `Cannot lock room in "${roomState.status}" state`);
      return;
    }

    // Store final snapshot if provided
    if (command.finalSnapshotCiphertext && command.finalSnapshotAtSeq !== undefined) {
      const atSeq = command.finalSnapshotAtSeq;
      if (atSeq > roomState.seq || atSeq < (roomState.snapshotSeq ?? 0)) {
        this.sendError(ws, 'invalid_snapshot_seq', `finalSnapshotAtSeq must be between ${roomState.snapshotSeq ?? 0} and ${roomState.seq}`);
        return;
      }
      roomState.snapshotCiphertext = command.finalSnapshotCiphertext;
      roomState.snapshotSeq = atSeq;
    }

    roomState.status = 'locked';
    roomState.lockedAt = Date.now();
    await this.ctx.storage.put('room', roomState);

    this.broadcastToAll({ type: 'room.status', status: 'locked' });
    safeLog('admin:room-locked', { roomId: roomState.roomId });
  }

  private async applyUnlock(
    ws: WebSocket,
    roomState: RoomDurableState,
  ): Promise<void> {
    if (roomState.status !== 'locked') {
      this.sendError(ws, 'invalid_state', `Cannot unlock room in "${roomState.status}" state`);
      return;
    }

    roomState.status = 'active';
    roomState.lockedAt = undefined;
    await this.ctx.storage.put('room', roomState);

    this.broadcastToAll({ type: 'room.status', status: 'active' });
    safeLog('admin:room-unlocked', { roomId: roomState.roomId });
  }

  private async applyDelete(
    ws: WebSocket,
    roomState: RoomDurableState,
  ): Promise<void> {
    if (roomState.status === 'deleted' || roomState.status === 'expired') {
      this.sendError(ws, 'invalid_state', 'Room is already in a terminal state');
      return;
    }

    // Write tombstone first — even if event purge fails, room is marked deleted
    const {
      snapshotCiphertext: _s,
      snapshotSeq: _ss,
      ...rest
    } = roomState;

    const deletedState: RoomDurableState = {
      ...rest,
      status: 'deleted',
      roomVerifier: '',
      adminVerifier: '',
      deletedAt: Date.now(),
    };

    // Write tombstone first — critical path
    try {
      await this.ctx.storage.put('room', deletedState);
    } catch (e) {
      safeLog('room:delete-storage-error', { roomId: roomState.roomId, error: String(e) });
      this.sendError(ws, 'delete_failed', 'Failed to delete room');
      this.closeRoomSockets('Room delete failed');
      return;
    }

    // Purge event keys (best-effort after tombstone)
    try {
      await this.purgeEventKeys();
    } catch (e) {
      safeLog('room:delete-purge-error', { roomId: roomState.roomId, error: String(e) });
    }

    this.broadcastToAll({ type: 'room.status', status: 'deleted' });
    this.closeRoomSockets('Room deleted');
    safeLog('admin:room-deleted', { roomId: roomState.roomId });
  }

  // ---------------------------------------------------------------------------
  // Storage Helpers
  // ---------------------------------------------------------------------------

  /** Delete all event keys from storage in batches of DELETE_BATCH_SIZE. */
  private async purgeEventKeys(): Promise<void> {
    const events = await this.ctx.storage.list({ prefix: 'event:' });
    if (events.size === 0) return;

    const keys = [...events.keys()];
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      await this.ctx.storage.delete(batch);
    }
  }

  // ---------------------------------------------------------------------------
  // Expiry + Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Transition room to expired status and purge sensitive material.
   * Writes tombstone first, then purges event keys (best-effort).
   * Returns true if the tombstone was written, false if storage failed.
   */
  private async markExpired(roomState: RoomDurableState, except?: WebSocket): Promise<boolean> {
    if (roomState.status === 'expired' || roomState.status === 'deleted') {
      return true;
    }

    const {
      snapshotCiphertext: _scrubCiphertext,
      snapshotSeq: _scrubSeq,
      ...rest
    } = roomState;

    const expiredState: RoomDurableState = {
      ...rest,
      status: 'expired',
      roomVerifier: '',
      adminVerifier: '',
      expiredAt: Date.now(),
    };

    // Write tombstone first — critical path
    try {
      await this.ctx.storage.put('room', expiredState);
    } catch (e) {
      safeLog('room:expire-storage-error', { roomId: roomState.roomId, error: String(e) });
      this.closeRoomSockets('Room expiry failed', except);
      return false;
    }

    // Purge event keys (best-effort after tombstone is written)
    try {
      await this.purgeEventKeys();
    } catch (e) {
      safeLog('room:expire-purge-error', { roomId: roomState.roomId, error: String(e) });
    }

    this.closeRoomSockets('Room expired', except);
    safeLog('room:expired', { roomId: roomState.roomId });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Broadcast Helpers
  // ---------------------------------------------------------------------------

  private broadcastToAll(message: RoomTransportMessage): void {
    const json = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      const att = socket.deserializeAttachment() as WebSocketAttachment | null;
      if (att?.authenticated) {
        try { socket.send(json); } catch { /* socket may have closed */ }
      }
    }
  }

  private broadcastToOthers(exclude: WebSocket, message: RoomTransportMessage): void {
    const json = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude) continue;
      const att = socket.deserializeAttachment() as WebSocketAttachment | null;
      if (att?.authenticated) {
        try { socket.send(json); } catch { /* socket may have closed */ }
      }
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    const error: RoomTransportMessage = { type: 'room.error', code, message };
    try { ws.send(JSON.stringify(error)); } catch { /* socket may have closed */ }
  }

  private closeRoomSockets(reason: string, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) {
        socket.close(WS_CLOSE_ROOM_UNAVAILABLE, reason);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket Lifecycle (Hibernation API)
  // ---------------------------------------------------------------------------

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const meta = ws.deserializeAttachment() as WebSocketAttachment | null;
    const roomId = meta?.roomId ?? 'unknown';
    const clientId = meta?.authenticated ? meta.clientId : 'unauthenticated';
    safeLog('ws:closed', { roomId, clientId, code });
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const meta = ws.deserializeAttachment() as WebSocketAttachment | null;
    const roomId = meta?.roomId ?? 'unknown';
    safeLog('ws:error', { roomId, error: String(error) });
  }
}
