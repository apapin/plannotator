/**
 * Owns the UI-facing state around lock / unlock / delete commands:
 * the in-flight action (for button disabling + "…ing" labels) and
 * the most recent failure (for the toast surface).
 *
 * Lives in `packages/ui/hooks` rather than next to the header
 * components because the AdminAction type is shared with
 * `AdminControls` and the `useCollabRoom` client wiring — the hook
 * just orchestrates; it doesn't own the protocol.
 *
 * State is single-slot by design: one pending action at a time, one
 * "last error" slot cleared on the next attempt or manual dismiss.
 * Admin commands are rare and user-initiated; a history queue would
 * be overengineering for V1.
 */

import { useCallback, useState } from 'react';
import type { UseCollabRoomReturn } from './useCollabRoom';
import type { AdminAction } from '../../components/collab/AdminControls';

export interface UseRoomAdminActionsReturn {
  /** Action currently in flight, if any. Drives button disabled + label. */
  pending: AdminAction | undefined;
  /** Most recent failure; null when clear. */
  error: { action: AdminAction; message: string } | null;
  /** Dispatch a lock/unlock/delete command. No-op when `room` is undefined. */
  run(action: AdminAction): Promise<void>;
  /** Clear the current error manually (user dismiss from toast). */
  dismissError(): void;
}

export function useRoomAdminActions(
  room: UseCollabRoomReturn | undefined,
): UseRoomAdminActionsReturn {
  const [pending, setPending] = useState<AdminAction | undefined>();
  const [error, setError] = useState<{ action: AdminAction; message: string } | null>(null);

  const run = useCallback(async (action: AdminAction) => {
    if (!room) return;
    setPending(action);
    setError(null);
    try {
      if (action === 'lock') await room.lock({ includeFinalSnapshot: true });
      else if (action === 'unlock') await room.unlock();
      else if (action === 'delete') await room.deleteRoom();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError({ action, message });
    } finally {
      setPending(undefined);
    }
  }, [room]);

  const dismissError = useCallback(() => setError(null), []);

  return { pending, error, run, dismissError };
}
