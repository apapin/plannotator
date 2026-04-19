import React from 'react';
import type { RoomStatus } from '@plannotator/shared/collab';

/**
 * Pure admin controls button strip. Renders Lock / Unlock / Delete as
 * appropriate for the current room status; emits callbacks for the parent
 * (RoomApp) to wire to `room.lock` / `room.unlock` / `room.deleteRoom`.
 *
 * Visibility: caller renders this component ONLY when
 * `room.hasAdminCapability` is true — we don't re-check here to keep the
 * component purely presentational.
 *
 * Buttons disable while an admin command is in-flight (`pendingAction`).
 * The parent owns the pending state because `room.lock()` resolves when
 * `room.status: locked` is observed, not when the promise resolves.
 */

export type AdminAction = 'lock' | 'unlock' | 'delete';

export interface AdminControlsProps {
  roomStatus: RoomStatus | null;
  pendingAction?: AdminAction;
  onLock(): void;
  onUnlock(): void;
  onDelete(): void;
  className?: string;
}

export function AdminControls({
  roomStatus,
  pendingAction,
  onLock,
  onUnlock,
  onDelete,
  className = '',
}: AdminControlsProps): React.ReactElement {
  const isLocked = roomStatus === 'locked';
  const isTerminal = roomStatus === 'deleted' || roomStatus === 'expired';
  const anyInFlight = pendingAction !== undefined;

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      data-testid="admin-controls"
    >
      {!isLocked && (
        <button
          type="button"
          disabled={anyInFlight || isTerminal}
          onClick={onLock}
          className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="admin-lock"
        >
          {pendingAction === 'lock' ? 'Locking…' : 'Lock'}
        </button>
      )}
      {isLocked && (
        <button
          type="button"
          disabled={anyInFlight || isTerminal}
          onClick={onUnlock}
          className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="admin-unlock"
        >
          {pendingAction === 'unlock' ? 'Unlocking…' : 'Unlock'}
        </button>
      )}
      <button
        type="button"
        disabled={anyInFlight || isTerminal}
        onClick={onDelete}
        className="px-2 py-1 text-xs rounded bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="admin-delete"
      >
        {pendingAction === 'delete' ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  );
}
