import React from 'react';
import type { ResizeHandleProps as BaseProps } from '../hooks/useResizablePanel';

interface Props extends BaseProps {
  className?: string;
  /**
   * Which panel this handle resizes, not which side of the boundary it's on.
   *
   * DO NOT SIMPLIFY — see GitHub issue #354 ("can't grab the scrollbar").
   * The overlay scrollbar from <OverlayScrollArea> is 10px at rest and
   * widens to 14px on hover. Its touch area must never overlap the 14px
   * scrollbar zone on whichever side it's adjacent to, or the scrollbar
   * becomes ungrabbable and users can't click-to-jump.
   *
   *   'left'  — resizes a left sidebar. The adjacent panel's scrollbar is
   *             on its own right edge (i.e. touching this handle). Extend
   *             the hit area LEFT (into the sidebar, away from the
   *             scrollbar) and limit right-side encroachment.
   *   'right' — resizes a right panel. The adjacent content area's
   *             scrollbar is on its own right edge (i.e. touching this
   *             handle). Extend the hit area RIGHT (into the panel, away
   *             from the scrollbar). The `left-3` (12px) offset clears the
   *             14px worst-case hover width; do not reduce it.
   */
  side?: 'left' | 'right';
}

export const ResizeHandle: React.FC<Props> = ({
  isDragging,
  onMouseDown,
  onTouchStart,
  onDoubleClick,
  className,
  side,
}) => (
  <div
    className={`relative w-0 cursor-col-resize flex-shrink-0 group z-10${className ? ` ${className}` : ''}`}
  >
    {/* Visible track — 4px wide, centered on the zero-width layout box */}
    <div className={`absolute inset-y-0 -left-0.5 -right-0.5 transition-colors ${
      isDragging ? 'bg-primary/50' : 'group-hover:bg-border'
    }`} />
    {/* Wider touch area — extends away from the adjacent 14px overlay
        scrollbar. See the `side` prop docs above before changing any value. */}
    <div
      className={`absolute inset-y-0 ${
        side === 'left' ? '-right-2 -left-1' :
        side === 'right' ? '-right-3 left-3' :
        '-inset-x-2'
      }`}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onDoubleClick={onDoubleClick}
    />
  </div>
);
