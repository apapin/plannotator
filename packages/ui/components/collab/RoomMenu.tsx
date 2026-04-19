import React, { useState } from 'react';
import type { RoomStatus } from '@plannotator/shared/collab';
import { ActionMenu, ActionMenuDivider, ActionMenuItem } from '../ActionMenu';
import type { AdminAction } from './AdminControls';

/**
 * Room actions dropdown, anchored in the editor header next to the
 * participant avatars. Replaces the floating `RoomPanel` — copy links,
 * copy consolidated feedback, and (for admins) lock / unlock / delete
 * and the admin recovery link disclosure all live behind one click.
 *
 * Click-outside / Esc close is handled by the shared `ActionMenu`
 * primitive. The trigger is a pill-shaped button with a link icon and
 * chevron, visually grouped with the avatar cluster but semantically
 * its own click target (avatars stay tooltip-only per the agreed UX).
 */

export interface RoomMenuProps {
  isAdmin: boolean;
  roomStatus: RoomStatus | null;
  /** Non-null when the caller holds admin capability. */
  adminUrl?: string;
  /** Set while an admin command is in flight; disables Lock/Unlock/Delete items. */
  pendingAdminAction?: AdminAction;
  onCopyParticipantUrl(): void;
  onCopyConsolidatedFeedback(): void;
  onCopyAdminUrl(): void;
  onLock(): void;
  onUnlock(): void;
  onDelete(): void;
}

// Small inline icons, same stroke + size convention as PlanHeaderMenu.
const ICON_CLASS = 'w-3.5 h-3.5';
const LinkIcon = (
  <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);
const CopyIcon = (
  <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);
const LockIcon = (
  <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m8-9V6a6 6 0 00-12 0v2m-2 0h16v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" />
  </svg>
);
const UnlockIcon = (
  <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2z" />
  </svg>
);
const DeleteIcon = (
  <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 7V3a1 1 0 011-1h2a1 1 0 011 1v4" />
  </svg>
);
const KeyIcon = (
  <svg className={ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
  </svg>
);
const ChevronIcon = (
  <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

export function RoomMenu({
  isAdmin,
  roomStatus,
  adminUrl,
  pendingAdminAction,
  onCopyParticipantUrl,
  onCopyConsolidatedFeedback,
  onCopyAdminUrl,
  onLock,
  onUnlock,
  onDelete,
}: RoomMenuProps): React.ReactElement {
  // Admin recovery link is disclosure-gated inside the menu, same as
  // the prior RoomPanel design — revealing the full admin URL behind a
  // click makes accidental copy-paste into the participant channel
  // harder.
  const [adminDisclosed, setAdminDisclosed] = useState(false);
  const isLocked = roomStatus === 'locked';

  return (
    <ActionMenu
      renderTrigger={({ isOpen, toggleMenu }) => (
        <button
          type="button"
          onClick={toggleMenu}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            isOpen
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          title="Room actions"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-testid="room-menu-trigger"
        >
          {/*
            Intentional visual distinction from "Copy participant link"
            inside the dropdown: the trigger uses 👥 (room / people),
            the link item inside uses the chain icon (a URL). Sharing
            the link icon on both was ambiguous — the reviewer flagged
            the trigger as reading like another "copy link" button.
          */}
          <span aria-hidden>👥</span>
          <span className="hidden sm:inline">Room</span>
          {ChevronIcon}
        </button>
      )}
      panelClassName="absolute top-full right-0 mt-1 w-60 rounded-lg border border-border bg-popover py-1 shadow-xl z-[70]"
    >
      {({ closeMenu }) => (
        <>
          <ActionMenuItem
            icon={LinkIcon}
            label="Copy participant link"
            onClick={() => {
              closeMenu();
              onCopyParticipantUrl();
            }}
          />
          <ActionMenuItem
            icon={CopyIcon}
            label="Copy consolidated feedback"
            onClick={() => {
              closeMenu();
              onCopyConsolidatedFeedback();
            }}
          />

          {isAdmin && (
            <>
              <ActionMenuDivider />
              {isLocked ? (
                <ActionMenuItem
                  icon={UnlockIcon}
                  label={pendingAdminAction === 'unlock' ? 'Unlocking…' : 'Unlock room'}
                  onClick={() => {
                    if (pendingAdminAction) return;
                    closeMenu();
                    onUnlock();
                  }}
                />
              ) : (
                <ActionMenuItem
                  icon={LockIcon}
                  label={pendingAdminAction === 'lock' ? 'Locking…' : 'Lock room'}
                  onClick={() => {
                    if (pendingAdminAction) return;
                    closeMenu();
                    onLock();
                  }}
                />
              )}

              {/*
                Admin recovery link: keep the two-step disclosure so a
                creator can't accidentally paste it into the same
                channel they share the participant link on. Menu stays
                open on toggle so the Copy button inside is reachable.
              */}
              <button
                type="button"
                onClick={() => setAdminDisclosed(v => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
                data-testid="admin-disclosure-toggle"
              >
                <span className="text-muted-foreground">{KeyIcon}</span>
                <span className="flex-1">
                  {adminDisclosed ? 'Hide admin recovery link' : 'Show admin recovery link'}
                </span>
              </button>
              {adminDisclosed && adminUrl && (
                <div className="px-3 pb-2 space-y-1">
                  <p className="text-[10px] text-amber-900 dark:text-amber-200 leading-tight">
                    Grants full admin control. Keep it private; do not share.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      onCopyAdminUrl();
                    }}
                    className="w-full px-2 py-1.5 text-xs rounded bg-destructive/10 text-destructive hover:bg-destructive/20"
                    data-testid="copy-admin-url"
                  >
                    Copy admin link
                  </button>
                </div>
              )}

              <ActionMenuDivider />
              <ActionMenuItem
                icon={<span className="text-destructive">{DeleteIcon}</span>}
                label={pendingAdminAction === 'delete' ? 'Deleting…' : 'Delete room'}
                onClick={() => {
                  if (pendingAdminAction) return;
                  closeMenu();
                  onDelete();
                }}
              />
            </>
          )}
        </>
      )}
    </ActionMenu>
  );
}
