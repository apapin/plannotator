import React, { useState } from 'react';
import type { ConnectionStatus } from '@plannotator/shared/collab/client';
import { PRESENCE_SWATCHES } from '@plannotator/ui/utils/presenceColor';

/**
 * Pre-connect identity gate for room participants. Parent mounts this
 * BEFORE connecting — captures a display name + color, then calls
 * `onJoin` with the settled identity. While connecting, this same
 * component also surfaces status messages (connecting / authenticating)
 * so the user has constant feedback.
 *
 * Both `initialDisplayName` and `initialColor` should come from the
 * user's Plannotator preferences (`getIdentity()` / `getPresenceColor()`).
 * Parent persists edits back via the corresponding setters after the
 * user submits; the gate itself is pure presentation.
 *
 * Fatal failure states (malformed URL / access denied / room deleted)
 * are rendered by the parent as a full-screen replacement — this gate
 * handles only the happy-path and the in-flight connection states.
 */

export interface JoinRoomSubmit {
  displayName: string;
  color: string;
}

export interface JoinRoomGateProps {
  initialDisplayName?: string;
  initialColor?: string;
  connectionStatus: ConnectionStatus;
  onJoin(submit: JoinRoomSubmit): void;
}

function statusMessage(s: ConnectionStatus): string | null {
  switch (s) {
    case 'connecting':     return 'Connecting to room…';
    case 'authenticating': return 'Verifying access…';
    case 'reconnecting':   return 'Reconnecting…';
    default:               return null;
  }
}

export function JoinRoomGate({
  initialDisplayName = '',
  initialColor = PRESENCE_SWATCHES[0],
  connectionStatus,
  onJoin,
}: JoinRoomGateProps): React.ReactElement {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [color, setColor] = useState(initialColor);
  const [submitted, setSubmitted] = useState(false);

  const showStatus = submitted && statusMessage(connectionStatus);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) return;
    setSubmitted(true);
    onJoin({ displayName: trimmed, color });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      data-testid="join-room-gate"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card border border-border rounded-xl shadow-2xl w-[380px] max-w-[90vw] p-5 space-y-4"
      >
        <h2 className="text-base font-semibold">Join live review</h2>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase text-muted-foreground">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            disabled={submitted}
            className="w-full px-2 py-1 border rounded text-sm"
            placeholder="Your name"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase text-muted-foreground">Color</label>
          <div className="flex items-center gap-1">
            {PRESENCE_SWATCHES.map(s => (
              <button
                key={s}
                type="button"
                disabled={submitted}
                onClick={() => setColor(s)}
                className={`w-6 h-6 rounded-full border-2 ${color === s ? 'border-foreground' : 'border-transparent'}`}
                style={{ backgroundColor: s }}
                aria-label={`Color ${s}`}
              />
            ))}
          </div>
        </div>

        {showStatus && (
          <div className="text-sm text-muted-foreground" data-testid="join-status">
            {showStatus}
          </div>
        )}

        <div className="flex items-center justify-end pt-2">
          <button
            type="submit"
            disabled={submitted || !displayName.trim()}
            className="px-3 py-1.5 text-sm rounded bg-foreground text-background disabled:opacity-50"
          >
            {submitted ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
    </div>
  );
}
