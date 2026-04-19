/** Plannotator Live Rooms protocol constants. */

/** Room secret is a 256-bit raw byte value. */
export const ROOM_SECRET_LENGTH_BYTES = 32;

/** Admin secret is a 256-bit raw byte value. Distinct symbol from the room
 * secret so the intent at each call site is explicit (even though the V1
 * protocol uses the same length for both). */
export const ADMIN_SECRET_LENGTH_BYTES = 32;

/**
 * WebSocket close code the server uses when the room is no longer available
 * (deleted, expired). Client code treats this as a terminal close.
 */
export const WS_CLOSE_ROOM_UNAVAILABLE = 4006;

/**
 * Close reason string the server sets after a successful admin-initiated
 * delete. The client treats (code === WS_CLOSE_ROOM_UNAVAILABLE && reason ===
 * WS_CLOSE_REASON_ROOM_DELETED) as the canonical "delete succeeded" signal.
 * Both server and client MUST import from here to avoid drift.
 */
export const WS_CLOSE_REASON_ROOM_DELETED = 'Room deleted';

/** Close reason string the server sets when a room has expired. Mapped to
 *  roomStatus = 'expired' on the client when the client missed the preceding
 *  room.status broadcast. */
export const WS_CLOSE_REASON_ROOM_EXPIRED = 'Room expired';
