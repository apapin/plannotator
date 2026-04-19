/**
 * Plannotator Live Rooms — client barrel export.
 *
 * Re-exports the server-safe barrel plus client-only URL helpers.
 * This is the import path for browser and direct-agent clients:
 *   import { ..., parseRoomUrl, buildRoomJoinUrl } from '@plannotator/shared/collab/client'
 */

export * from './index';
export * from './url';

// Client runtime (WebSocket + stateful client)
export * from './client-runtime/client';
export * from './client-runtime/create-room';
export * from './client-runtime/join-room';
export * from './client-runtime/types';
