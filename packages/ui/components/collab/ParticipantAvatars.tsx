import React, { useMemo } from 'react';
import type { PresenceState } from '@plannotator/shared/collab';

/**
 * Pure avatar stack for room participants. Reads from `remotePresence`
 * (keyed by clientId) and renders one colored initial per peer. Does NOT
 * include the local user — callers render their own user elsewhere.
 *
 * Overflow: show at most `maxVisible` avatars; the rest are summarized
 * as "+N" with a tooltip listing the extra names.
 */

export interface ParticipantAvatarsProps {
  remotePresence: Record<string, PresenceState>;
  maxVisible?: number;
  className?: string;
}

interface Participant {
  clientId: string;
  name: string;
  color: string;
  initial: string;
}

function deriveParticipants(
  remotePresence: Record<string, PresenceState>,
): Participant[] {
  const out: Participant[] = [];
  for (const [clientId, p] of Object.entries(remotePresence)) {
    const name = (p.user?.name ?? '').trim() || 'Guest';
    const color = p.user?.color ?? '#888';
    const initial = name.charAt(0).toUpperCase() || '?';
    out.push({ clientId, name, color, initial });
  }
  // Stable sort by name so order doesn't thrash when presence maps rehydrate.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function ParticipantAvatars({
  remotePresence,
  maxVisible = 4,
  className = '',
}: ParticipantAvatarsProps): React.ReactElement | null {
  const participants = useMemo(() => deriveParticipants(remotePresence), [remotePresence]);
  if (participants.length === 0) return null;

  const visible = participants.slice(0, maxVisible);
  const overflow = participants.slice(maxVisible);
  const overflowTitle = overflow.map(p => p.name).join(', ');

  return (
    <div
      className={`inline-flex items-center -space-x-1 ${className}`}
      data-testid="participant-avatars"
    >
      {visible.map(p => (
        <span
          key={p.clientId}
          title={p.name}
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-medium text-white ring-2 ring-background"
          style={{ backgroundColor: p.color }}
          data-participant-id={p.clientId}
        >
          {p.initial}
        </span>
      ))}
      {overflow.length > 0 && (
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-medium bg-muted text-muted-foreground ring-2 ring-background"
          title={overflowTitle}
          data-testid="participant-overflow"
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}
