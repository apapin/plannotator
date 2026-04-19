/**
 * Client runtime barrel. Re-exports public API for browser + direct-agent clients.
 *
 * Consumers typically import from `@plannotator/shared/collab/client`, which
 * re-exports this barrel plus base types.
 */

export * from './client';
export * from './create-room';
export * from './join-room';
export type {
  ConnectionStatus,
  CollabRoomUser,
  CollabRoomState,
  CollabRoomEvents,
  CreateRoomOptions,
  CreateRoomResult,
  JoinRoomOptions,
  ReconnectOptions,
} from './types';
