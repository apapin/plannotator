/**
 * StickyHeaderLane — compact "ghost" header that pins at the top of <main>
 * when the user scrolls past the AnnotationToolstrip.
 *
 * At rest (top of doc): invisible, non-interactive. The original toolstrip and
 * badge cluster on the card remain the visible source of truth.
 *
 * Scrolled: fades + slides in at top: 12px, sitting on the same horizontal
 * lane as the already-sticky action buttons inside the Viewer card. Contains
 * a compact <AnnotationToolstrip compact /> + a row-layout <DocBadges />.
 *
 * No state is duplicated — all props are passed through from App.tsx.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AnnotationToolstrip } from './AnnotationToolstrip';
import { DocBadges } from './DocBadges';
import type { EditorMode, InputMethod } from '../types';
import type { PlanDiffStats } from '../utils/planDiffEngine';

interface StickyHeaderLaneProps {
  // Toolstrip state
  inputMethod: InputMethod;
  onInputMethodChange: (method: InputMethod) => void;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  taterMode?: boolean;

  // Badge state
  repoInfo?: { display: string; branch?: string } | null;
  planDiffStats?: PlanDiffStats | null;
  isPlanDiffActive?: boolean;
  hasPreviousVersion?: boolean;
  onPlanDiffToggle?: () => void;
  archiveInfo?: { status: 'approved' | 'denied' | 'unknown'; timestamp: string; title: string } | null;

  // Layout
  maxWidth?: number;
}

export const StickyHeaderLane: React.FC<StickyHeaderLaneProps> = ({
  inputMethod,
  onInputMethodChange,
  mode,
  onModeChange,
  taterMode,
  repoInfo,
  planDiffStats,
  isPlanDiffActive,
  hasPreviousVersion,
  onPlanDiffToggle,
  archiveInfo,
  maxWidth,
}) => {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  // IntersectionObserver-on-sentinel pattern (mirrors Viewer.tsx:257-267).
  // Sentinel sits inline at the natural position the bar would occupy; when
  // it leaves the viewport, the bar pins. The positive top rootMargin grows
  // the effective viewport upward so the sentinel is considered "visible"
  // for an extra ~72px of scroll — delaying the bar's appearance until the
  // real toolstrip has actually scrolled past the top of <main>. Without
  // this, the sentinel (which sits at the top of the column, above the
  // toolstrip) fires the moment scrolling begins and the bar doubles up
  // with the still-visible toolstrip.
  useEffect(() => {
    if (!sentinelRef.current) return;
    const scrollContainer = document.querySelector('main');
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { root: scrollContainer, rootMargin: '72px 0px 0px 0px', threshold: 0 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Sentinel — zero-size, rendered in normal flow at the top of <main>.
          When it scrolls out of the viewport, the sticky bar fades in. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-0 w-0" />

      {/* Sticky wrapper — zero-height so it never pushes content down. The
          visible bar is positioned absolutely relative to this wrapper.
          The Viewer's outer wrapper uses z-50 (Viewer.tsx:432), so the
          sticky lane must sit above that to paint over the card. */}
      <div
        aria-hidden={!isStuck}
        className="sticky top-3 z-[60] w-full self-center pointer-events-none"
        style={{ maxWidth, height: 0 }}
      >
        {/* Content-width bar — left-aligned, sized to its contents. The
            Viewer's sticky action buttons live on the right side of the
            card on the same top: 12px lane; keeping this bar content-width
            (not full-width) avoids any background/chrome overlap. */}
        <div
          className={`absolute left-3 md:left-5 lg:left-7 xl:left-9 top-0 inline-flex items-center gap-3 rounded-lg px-2 py-1 md:px-3 md:py-1.5 bg-card/95 backdrop-blur-sm shadow-sm border border-border/30 motion-reduce:transform-none ${
            isStuck
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-1 pointer-events-none'
          }`}
          style={{
            transition:
              'opacity 180ms cubic-bezier(0.2, 0, 0, 1), transform 180ms cubic-bezier(0.2, 0, 0, 1)',
            willChange: 'opacity, transform',
          }}
        >
          <AnnotationToolstrip
            inputMethod={inputMethod}
            onInputMethodChange={onInputMethodChange}
            mode={mode}
            onModeChange={onModeChange}
            taterMode={taterMode}
            compact
          />
          <DocBadges
            layout="row"
            repoInfo={repoInfo}
            planDiffStats={planDiffStats}
            isPlanDiffActive={isPlanDiffActive}
            hasPreviousVersion={hasPreviousVersion}
            onPlanDiffToggle={onPlanDiffToggle}
            archiveInfo={archiveInfo}
          />
        </div>
      </div>
    </>
  );
};
