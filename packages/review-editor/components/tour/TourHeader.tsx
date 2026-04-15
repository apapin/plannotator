import React from 'react';

interface TourHeaderProps {
  title: string;
  stopCount: number;
}

export const TourHeader: React.FC<TourHeaderProps> = ({ title, stopCount }) => (
  <div className="flex-shrink-0 flex items-center gap-2 px-6 py-3 border-b border-border/30">
    <span className="text-sm font-semibold tracking-tight text-foreground truncate flex-1">
      {title}
    </span>
    <span className="text-[10px] font-mono bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
      {stopCount} stop{stopCount !== 1 ? 's' : ''}
    </span>
  </div>
);
