import React from 'react';
import type { ConnectionStatus } from '@plannotator/shared/collab/client';
import type { RoomStatus } from '@plannotator/shared/collab';

/**
 * Pure status-pill for the live room. Reads connection + room status and
 * shows a single summary label to the user. No side effects; identity
 * driven entirely by props so memoization is trivial.
 *
 * Priority (highest wins): roomStatus === 'deleted' > 'expired' > 'locked' >
 * connectionStatus ('reconnecting' / 'connecting' / 'authenticating' /
 * 'disconnected' / 'closed') > default 'Live'.
 */

export interface RoomStatusBadgeProps {
  connectionStatus: ConnectionStatus;
  roomStatus: RoomStatus | null;
  className?: string;
}

interface Variant {
  label: string;
  dotClass: string;
  /** Bg/text utility class bundle for the pill itself. */
  pillClass: string;
}

function deriveVariant(
  connectionStatus: ConnectionStatus,
  roomStatus: RoomStatus | null,
): Variant {
  if (roomStatus === 'deleted') {
    return { label: 'Room deleted', dotClass: 'bg-destructive', pillClass: 'bg-destructive/10 text-destructive' };
  }
  if (roomStatus === 'expired') {
    return { label: 'Expired', dotClass: 'bg-muted-foreground', pillClass: 'bg-muted text-muted-foreground' };
  }
  if (roomStatus === 'locked') {
    return { label: 'Locked', dotClass: 'bg-warning', pillClass: 'bg-warning/10 text-warning' };
  }
  if (connectionStatus === 'reconnecting') {
    return { label: 'Reconnecting', dotClass: 'bg-warning animate-pulse', pillClass: 'bg-warning/10 text-warning' };
  }
  if (connectionStatus === 'connecting' || connectionStatus === 'authenticating') {
    return { label: 'Connecting', dotClass: 'bg-primary animate-pulse', pillClass: 'bg-primary/10 text-primary' };
  }
  if (connectionStatus === 'disconnected' || connectionStatus === 'closed') {
    return { label: 'Offline', dotClass: 'bg-muted-foreground', pillClass: 'bg-muted text-muted-foreground' };
  }
  return { label: 'Live', dotClass: 'bg-success', pillClass: 'bg-success/10 text-success' };
}

export function RoomStatusBadge({
  connectionStatus,
  roomStatus,
  className = '',
}: RoomStatusBadgeProps): React.ReactElement {
  const variant = deriveVariant(connectionStatus, roomStatus);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${variant.pillClass} ${className}`}
      aria-live="polite"
      data-testid="room-status-badge"
      data-status-label={variant.label}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${variant.dotClass}`} aria-hidden />
      {variant.label}
    </span>
  );
}
