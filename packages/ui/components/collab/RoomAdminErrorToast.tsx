import React, { useEffect } from 'react';
import type { AdminAction } from './AdminControls';

/**
 * Bottom-right toast for lock / unlock / delete failures. Replaces
 * the inline error banner that used to live inside `RoomPanel`. A
 * transient toast matches the action-is-rare-and-retriable shape of
 * admin commands better than a sticky panel element: the user clicks,
 * nothing happens if it failed, they see the toast, click Dismiss or
 * let it auto-dismiss, and click again.
 *
 * Auto-dismiss is 8s — long enough for the user to read a short
 * error message, short enough that a forgotten toast doesn't linger
 * across sessions. Manual dismiss is always available.
 */

export interface RoomAdminErrorToastProps {
  action: AdminAction;
  message: string;
  onDismiss(): void;
}

const AUTO_DISMISS_MS = 8_000;

function actionLabel(action: AdminAction): string {
  switch (action) {
    case 'lock':   return 'Failed to lock room';
    case 'unlock': return 'Failed to unlock room';
    case 'delete': return 'Failed to delete room';
  }
}

export function RoomAdminErrorToast({
  action,
  message,
  onDismiss,
}: RoomAdminErrorToastProps): React.ReactElement {
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // Dep on message + action so a fresh error resets the timer.
  }, [action, message, onDismiss]);

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[60] max-w-sm px-3 py-2 rounded-lg text-xs font-medium shadow-lg bg-destructive/15 text-destructive border border-destructive/30 flex items-start gap-2"
      data-testid="room-admin-error-toast"
    >
      <div className="flex-1">
        <div className="font-semibold">{actionLabel(action)}</div>
        {message && <div className="opacity-80 mt-0.5 break-words">{message}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[11px] underline opacity-80 hover:opacity-100"
        aria-label="Dismiss error"
        data-testid="room-admin-error-toast-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
