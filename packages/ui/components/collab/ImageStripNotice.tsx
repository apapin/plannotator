import React from 'react';

/**
 * Dismissible banner shown after room creation when one or more local
 * annotations carried images that were stripped for the shared snapshot.
 * Text annotations are preserved; only the image attachments are dropped.
 *
 * Presentational only — parent controls mount/unmount and dismissal.
 */

export interface ImageStripNoticeProps {
  strippedCount: number;
  onDismiss(): void;
  className?: string;
}

export function ImageStripNotice({
  strippedCount,
  onDismiss,
  className = '',
}: ImageStripNoticeProps): React.ReactElement | null {
  if (strippedCount <= 0) return null;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 p-3 rounded border border-warning/20 bg-warning/10 text-warning text-sm ${className}`}
      data-testid="image-strip-notice"
    >
      <div className="flex-1">
        <strong>Images stripped.</strong>{' '}
        {strippedCount} item{strippedCount === 1 ? '' : 's'} with image attachments {strippedCount === 1 ? 'was' : 'were'} removed before sharing — text comments are preserved. Your local copies are unchanged.
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs underline opacity-80 hover:opacity-100"
        aria-label="Dismiss image-strip notice"
      >
        Dismiss
      </button>
    </div>
  );
}
