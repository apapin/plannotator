import React, { useMemo } from 'react';
import type { PresenceState } from '@plannotator/shared/collab';
import { isAgentIdentity, getAgentType } from '@plannotator/ui/utils/agentIdentity';

/**
 * Pure avatar stack for room participants. Reads from `remotePresence`
 * (keyed by clientId) and renders one colored initial per peer. Does NOT
 * include the local user — callers render their own user elsewhere.
 *
 * Overflow: show at most `maxVisible` avatars; the rest are summarized
 * as "+N" with a tooltip listing the extra names.
 *
 * Agent peers (identity ending in `-agent-<type>`) render with a small
 * marker overlay so observers can tell them apart from human peers.
 * Detection is purely identity-based via `isAgentIdentity` — no other
 * protocol fields are consulted.
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
  isAgent: boolean;
  agentType: string | undefined;
}

function deriveParticipants(
  remotePresence: Record<string, PresenceState>,
): Participant[] {
  const out: Participant[] = [];
  for (const [clientId, p] of Object.entries(remotePresence)) {
    const name = (p.user?.name ?? '').trim() || 'Guest';
    const color = p.user?.color ?? '#888';
    const initial = name.charAt(0).toUpperCase() || '?';
    const isAgent = isAgentIdentity(name);
    const agentType = getAgentType(name);
    out.push({ clientId, name, color, initial, isAgent, agentType });
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
          // Tooltip distinguishes agents so hover reveals the type; the
          // marker itself is the glyph at the corner of the avatar chip.
          title={p.isAgent ? `${p.name} (agent · ${p.agentType ?? 'unknown'})` : p.name}
          className="relative inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-medium text-white ring-2 ring-background"
          style={{ backgroundColor: p.color }}
          data-participant-id={p.clientId}
          data-participant-kind={p.isAgent ? 'agent' : 'human'}
        >
          {p.initial}
          {p.isAgent && (
            <span
              aria-hidden
              // Small ⚙ marker pinned to the bottom-right corner. Theme
              // tokens so it stays legible on both light and dark
              // themes; no color prop needed.
              className="absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center w-3 h-3 rounded-full text-[8px] leading-none bg-background text-foreground ring-1 ring-border"
              data-testid="participant-agent-marker"
            >
              ⚙
            </span>
          )}
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
