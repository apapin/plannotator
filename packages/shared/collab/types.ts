/**
 * Plannotator Live Rooms — canonical protocol types.
 *
 * RoomAnnotation is a structural copy of the Annotation type from
 * packages/ui/types.ts with the `images` field excluded (V1 rooms
 * do not support image attachments). If Annotation gains new fields,
 * they must be manually added here when they should be part of the
 * room protocol.
 *
 * RoomState is intentionally NOT defined here — it contains server-only
 * fields (roomVerifier, adminVerifier, event log) and belongs in
 * apps/room-service (Slice 2).
 */

// ---------------------------------------------------------------------------
// Room Annotation
// ---------------------------------------------------------------------------

/** Annotation type values matching AnnotationType enum in packages/ui/types.ts */
export type RoomAnnotationType = 'DELETION' | 'COMMENT' | 'GLOBAL_COMMENT';

/**
 * Room-safe annotation. Structurally matches Annotation from packages/ui/types.ts
 * minus the images field. V1 rooms do not support image attachments.
 */
export interface RoomAnnotation {
  id: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  type: RoomAnnotationType;
  text?: string;
  originalText: string;
  createdA: number;
  author?: string;
  source?: string;
  isQuickLabel?: boolean;
  quickLabelTip?: string;
  diffContext?: 'added' | 'removed' | 'modified';
  startMeta?: { parentTagName: string; parentIndex: number; textOffset: number };
  endMeta?: { parentTagName: string; parentIndex: number; textOffset: number };
  images?: never;
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export interface CursorState {
  blockId?: string;
  x: number;
  y: number;
  coordinateSpace: 'block' | 'document' | 'viewport';
}

export interface PresenceState {
  user: { id: string; name: string; color: string };
  cursor: CursorState | null;
  activeAnnotationId?: string | null;
  idle?: boolean;
}

// ---------------------------------------------------------------------------
// Server Envelope
// ---------------------------------------------------------------------------

/**
 * Server-visible message wrapper. The DO can read clientId, opId, and channel
 * but cannot read the encrypted ciphertext.
 *
 * clientId is random per WebSocket connection — not a stable user identity.
 * Stable identity lives inside the encrypted PresenceState.user.id.
 */
export interface ServerEnvelope {
  clientId: string;
  opId: string;
  channel: 'event' | 'presence';
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Client Operations (encrypted inside envelope ciphertext)
// ---------------------------------------------------------------------------

export type RoomClientOp =
  | { type: 'annotation.add'; annotations: RoomAnnotation[] }
  | { type: 'annotation.update'; id: string; patch: Partial<RoomAnnotation> }
  | { type: 'annotation.remove'; ids: string[] }
  | { type: 'annotation.clear'; source?: string }
  | { type: 'presence.update'; presence: PresenceState };

// ---------------------------------------------------------------------------
// Server Events (decrypted by client from envelope ciphertext)
// ---------------------------------------------------------------------------

export type RoomServerEvent =
  | { type: 'snapshot'; payload: RoomSnapshot; snapshotSeq: number }
  | { type: 'annotation.add'; annotations: RoomAnnotation[] }
  | { type: 'annotation.update'; id: string; patch: Partial<RoomAnnotation> }
  | { type: 'annotation.remove'; ids: string[] }
  | { type: 'annotation.clear'; source?: string }
  | { type: 'presence.update'; clientId: string; presence: PresenceState };

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface RoomSnapshot {
  versionId: 'v1';
  planMarkdown: string;
  annotations: RoomAnnotation[];
}

// ---------------------------------------------------------------------------
// Transport Messages (server-to-client, pre-decryption)
// ---------------------------------------------------------------------------

export type RoomTransportMessage =
  | { type: 'room.snapshot'; snapshotSeq: number; snapshotCiphertext: string }
  | { type: 'room.event'; seq: number; receivedAt: number; envelope: ServerEnvelope }
  | { type: 'room.presence'; envelope: ServerEnvelope }
  | { type: 'room.status'; status: RoomStatus }
  | { type: 'room.error'; code: string; message: string };

// ---------------------------------------------------------------------------
// Room Status
// ---------------------------------------------------------------------------

export type RoomStatus = 'created' | 'active' | 'locked' | 'deleted' | 'expired';

// ---------------------------------------------------------------------------
// Sequenced Envelope (for event log storage)
// ---------------------------------------------------------------------------

export interface SequencedEnvelope {
  seq: number;
  receivedAt: number;
  envelope: ServerEnvelope;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthChallenge {
  type: 'auth.challenge';
  challengeId: string;
  nonce: string;
  expiresAt: number;
}

export interface AuthResponse {
  type: 'auth.response';
  challengeId: string;
  clientId: string;
  proof: string;
  lastSeq?: number;
}

export interface AuthAccepted {
  type: 'auth.accepted';
  roomStatus: RoomStatus;
  seq: number;
  snapshotSeq?: number;
  snapshotAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type AdminCommand =
  | { type: 'room.lock'; finalSnapshotCiphertext?: string; finalSnapshotAtSeq?: number }
  | { type: 'room.unlock' }
  | { type: 'room.delete' };

export interface AdminChallengeRequest {
  type: 'admin.challenge.request';
}

export interface AdminChallenge {
  type: 'admin.challenge';
  challengeId: string;
  nonce: string;
  expiresAt: number;
}

export interface AdminCommandEnvelope {
  type: 'admin.command';
  challengeId: string;
  clientId: string;
  command: AdminCommand;
  adminProof: string;
}

// ---------------------------------------------------------------------------
// Room Creation
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  roomId: string;
  roomVerifier: string;
  adminVerifier: string;
  initialSnapshotCiphertext: string;
  expiresInDays?: number;
}

export interface CreateRoomResponse {
  roomId: string;
  status: 'active';
  seq: 0;
  snapshotSeq: 0;
  joinUrl: string;
  websocketUrl: string;
}

// ---------------------------------------------------------------------------
// Agent-Readable State
// ---------------------------------------------------------------------------

export interface AgentReadableRoomState {
  roomId: string;
  status: RoomStatus;
  versionId: 'v1';
  planMarkdown: string;
  annotations: RoomAnnotation[];
}
