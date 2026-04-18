/**
 * Plannotator Room Durable Object.
 *
 * Uses Cloudflare Workers WebSocket Hibernation API.
 * All per-connection state lives in WebSocket attachments
 * (survives DO hibernation).
 *
 * Slice 2 scope: room creation + WebSocket challenge-response auth.
 * No event sequencing, replay, presence relay, or admin commands.
 */

import type {
  AuthChallenge,
  AuthResponse,
  AuthAccepted,
  CreateRoomRequest,
  CreateRoomResponse,
} from '@plannotator/shared/collab';
import { verifyAuthProof, generateChallengeId, generateNonce } from '@plannotator/shared/collab';
import { DurableObject } from 'cloudflare:workers';
import type { Env, RoomDurableState, WebSocketAttachment } from './types';
import { clampExpiryDays, hasRoomExpired } from './validation';
import { safeLog } from './log';

const CHALLENGE_TTL_MS = 30_000; // 30 seconds

// WebSocket close codes
const WS_CLOSE_AUTH_REQUIRED = 4001;
const WS_CLOSE_UNKNOWN_CHALLENGE = 4002;
const WS_CLOSE_CHALLENGE_EXPIRED = 4003;
const WS_CLOSE_INVALID_PROOF = 4004;
const WS_CLOSE_PROTOCOL_ERROR = 4005;
const WS_CLOSE_ROOM_UNAVAILABLE = 4006;

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

    // Check for existing room
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
      snapshotCiphertext: body.initialSnapshotCiphertext,
      snapshotSeq: 0,
      eventLog: [],
      expiresAt: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
    };

    try {
      await this.ctx.storage.put('room', state);
    } catch (e) {
      safeLog('room:create-storage-error', { roomId: body.roomId, error: String(e) });
      return Response.json({ error: 'Failed to store room state' }, { status: 507 });
    }

    // Build URLs without secrets — use URL parser to handle trailing slashes/paths safely
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
    // Load room state to check existence
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

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Generate challenge
    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;

    // Accept with hibernation API
    this.ctx.acceptWebSocket(server);

    // Store pre-auth state in WebSocket attachment (survives hibernation)
    const attachment: WebSocketAttachment = {
      authenticated: false,
      roomId: roomState.roomId,
      challengeId,
      nonce,
      expiresAt,
    };
    server.serializeAttachment(attachment);

    // Send challenge
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

    let msg: { type?: string; [key: string]: unknown };
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
      // Validate auth.response fields before trusting them
      if (
        typeof msg.challengeId !== 'string' || !msg.challengeId ||
        typeof msg.clientId !== 'string' || !msg.clientId ||
        typeof msg.proof !== 'string' || !msg.proof
      ) {
        ws.close(WS_CLOSE_PROTOCOL_ERROR, 'Malformed auth response');
        return;
      }
      const authResponse: AuthResponse = {
        type: 'auth.response',
        challengeId: msg.challengeId as string,
        clientId: msg.clientId as string,
        proof: msg.proof as string,
        lastSeq: typeof msg.lastSeq === 'number' ? msg.lastSeq : undefined,
      };
      await this.handleAuthResponse(ws, meta, authResponse);
      return;
    }

    // Post-auth: Slice 2 ignores all messages (Slice 3 adds sequencing)
  }

  private async handleAuthResponse(
    ws: WebSocket,
    meta: Extract<WebSocketAttachment, { authenticated: false }>,
    authResponse: AuthResponse,
  ): Promise<void> {
    // Verify challenge ID matches
    if (authResponse.challengeId !== meta.challengeId) {
      safeLog('ws:auth-rejected', { reason: 'unknown-challenge', roomId: meta.roomId });
      ws.close(WS_CLOSE_UNKNOWN_CHALLENGE, 'Unknown challenge');
      return;
    }

    // Check expiry
    if (Date.now() > meta.expiresAt) {
      safeLog('ws:auth-rejected', { reason: 'expired', roomId: meta.roomId });
      ws.close(WS_CLOSE_CHALLENGE_EXPIRED, 'Challenge expired');
      return;
    }

    // Load room state for verifier
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

    // Verify proof
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

    // Auth successful — update attachment to authenticated state
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

    safeLog('ws:authenticated', { roomId: meta.roomId, clientId: authResponse.clientId });
  }

  /**
   * Transition room to expired status and purge sensitive material.
   * Returns true if the tombstone was written, false if storage failed.
   * Callers should still return 410/close even on false — fail closed.
   */
  private async markExpired(roomState: RoomDurableState, except?: WebSocket): Promise<boolean> {
    if (roomState.status === 'expired') {
      return true;
    }

    // Destructure out sensitive material — don't use delete on typed objects
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
      eventLog: [],
      expiredAt: Date.now(),
    };

    try {
      await this.ctx.storage.put('room', expiredState);
    } catch (e) {
      safeLog('room:expire-storage-error', { roomId: roomState.roomId, error: String(e) });
      this.closeRoomSockets('Room expiry failed', except);
      return false;
    }

    this.closeRoomSockets('Room expired', except);
    safeLog('room:expired', { roomId: roomState.roomId });
    return true;
  }

  /** Close all accepted WebSockets, optionally skipping one (e.g., the caller's socket). */
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
