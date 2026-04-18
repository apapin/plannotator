/**
 * Server-only types for the room-service Durable Object.
 *
 * RoomDurableState is the persistent room record stored in DO storage.
 * WebSocketAttachment is serialized per-connection metadata that survives
 * DO hibernation via serializeAttachment/deserializeAttachment.
 */

import type { RoomStatus, SequencedEnvelope } from '@plannotator/shared/collab';

// ---------------------------------------------------------------------------
// Worker Environment
// ---------------------------------------------------------------------------

/** Cloudflare Worker environment bindings. */
export interface Env {
  ROOM: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  ALLOW_LOCALHOST_ORIGINS?: string;
  BASE_URL?: string;
}

/** Durable state stored in DO storage under key 'room'. */
export interface RoomDurableState {
  /** Stored at creation — DO can't reverse idFromName(). */
  roomId: string;
  status: RoomStatus;
  roomVerifier: string;
  adminVerifier: string;
  seq: number;
  snapshotCiphertext?: string;
  snapshotSeq?: number;
  /** Empty in Slice 2 — populated by Slice 3 event sequencing. */
  eventLog: SequencedEnvelope[];
  lockedAt?: number;
  deletedAt?: number;
  expiredAt?: number;
  expiresAt: number;
}

/**
 * WebSocket attachment — survives hibernation via serializeAttachment/deserializeAttachment.
 *
 * Pre-auth: holds pending challenge state so the DO can verify after waking.
 * Post-auth: holds authenticated connection metadata.
 * Both variants carry roomId so webSocketMessage() can access it without a storage read.
 */
export type WebSocketAttachment =
  | { authenticated: false; roomId: string; challengeId: string; nonce: string; expiresAt: number }
  | { authenticated: true; roomId: string; clientId: string; authenticatedAt: number };
