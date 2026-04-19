import React from 'react';
import type { ConnectionStatus } from '@plannotator/shared/collab/client';
import type { PresenceState, RoomStatus } from '@plannotator/shared/collab';
import { RoomStatusBadge } from './RoomStatusBadge';
import { ParticipantAvatars } from './ParticipantAvatars';
import { RoomMenu } from './RoomMenu';
import type { AdminAction } from './AdminControls';

/**
 * Compact header cluster that replaces the floating RoomPanel.
 * Renders inline in the editor header next to the existing PlanHeaderMenu
 * whenever the editor is in room mode.
 *
 * Layout (left → right):
 *   [conditional status pill] [peer avatars] [Room actions ▾]
 *
 * The status pill is shown only when the room is in a non-default
 * state — locked, reconnecting, connecting, or offline. A healthy
 * "Live" connection shows nothing here, keeping the header quiet on
 * the common case. Avatars are peers-only (the user is implied); the
 * Room menu exposes copy-link + copy-feedback + admin actions.
 *
 * All mutations (lock/unlock/delete, link copy, feedback copy) are
 * owned by the caller. This component is a pure surface.
 */

export interface RoomHeaderControlsProps {
  connectionStatus: ConnectionStatus;
  roomStatus: RoomStatus | null;
  remotePresence: Record<string, PresenceState>;
  isAdmin: boolean;
  adminUrl?: string;
  pendingAdminAction?: AdminAction;
  onCopyParticipantUrl(): void;
  onCopyAdminUrl(): void;
  onCopyConsolidatedFeedback(): void;
  onLock(): void;
  onUnlock(): void;
  onDelete(): void;
  className?: string;
}

/**
 * "Healthy" states where the status pill adds noise without
 * information: we're authenticated to an active, non-locked room.
 * Anything outside that set is either a transient connection state
 * the user should know about (reconnecting / connecting) or a
 * product-level non-default (locked / expired / deleted).
 */
function shouldShowStatusPill(
  connectionStatus: ConnectionStatus,
  roomStatus: RoomStatus | null,
): boolean {
  const healthyConnection = connectionStatus === 'authenticated';
  const healthyRoom = roomStatus === 'active' || roomStatus === null;
  return !(healthyConnection && healthyRoom);
}

export function RoomHeaderControls({
  connectionStatus,
  roomStatus,
  remotePresence,
  isAdmin,
  adminUrl,
  pendingAdminAction,
  onCopyParticipantUrl,
  onCopyAdminUrl,
  onCopyConsolidatedFeedback,
  onLock,
  onUnlock,
  onDelete,
  className = '',
}: RoomHeaderControlsProps): React.ReactElement {
  const showStatus = shouldShowStatusPill(connectionStatus, roomStatus);
  const hasPeers = Object.keys(remotePresence).length > 0;

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      data-testid="room-header-controls"
    >
      {showStatus && (
        <RoomStatusBadge
          connectionStatus={connectionStatus}
          roomStatus={roomStatus}
        />
      )}
      {hasPeers && (
        <ParticipantAvatars remotePresence={remotePresence} />
      )}
      <RoomMenu
        isAdmin={isAdmin}
        roomStatus={roomStatus}
        adminUrl={adminUrl}
        pendingAdminAction={pendingAdminAction}
        onCopyParticipantUrl={onCopyParticipantUrl}
        onCopyAdminUrl={onCopyAdminUrl}
        onCopyConsolidatedFeedback={onCopyConsolidatedFeedback}
        onLock={onLock}
        onUnlock={onUnlock}
        onDelete={onDelete}
      />
    </div>
  );
}
