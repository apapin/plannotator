import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { TourDiffAnchor } from '../../hooks/useTourData';
import { DiffHunkPreview } from '../DiffHunkPreview';

interface DiffAnchorChipProps {
  anchor: TourDiffAnchor;
  onClick: () => void;
}

export const DiffAnchorChip: React.FC<DiffAnchorChipProps> = ({ anchor, onClick }) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button
        onClick={onClick}
        className="tour-anchor-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono cursor-pointer bg-muted/40 border border-border/25 text-foreground/60 hover:bg-muted/70 hover:border-border/40 hover:text-foreground/80 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background transition-[background-color,border-color,color] duration-150 outline-none"
      >
        {/* File icon */}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-muted-foreground/50 flex-shrink-0">
          <path d="M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="truncate max-w-[180px]">{anchor.label}</span>
        <span className="text-[10px] text-muted-foreground/40 whitespace-nowrap">
          L{anchor.line}–{anchor.end_line}
        </span>
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
        className="tour-anchor-tooltip z-[9998] w-[400px] rounded-lg bg-popover border border-border/40 shadow-lg overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">
            {anchor.file}
          </span>
          <span className="text-[10px] text-muted-foreground/40 whitespace-nowrap">
            L{anchor.line}–{anchor.end_line}
          </span>
        </div>
        <DiffHunkPreview hunk={anchor.hunk} maxHeight={160} />
        <Tooltip.Arrow className="fill-popover" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);
