/**
 * StickyHeaderLane — compact "ghost" header that pins as the user scrolls
 * past the AnnotationToolstrip.
 *
 * At rest (top of doc): invisible, non-interactive. The original toolstrip
 * and badge cluster on the card remain the visible source of truth.
 *
 * Scrolled, sm+ (640px): fades + slides in at top: 12px, sitting on the
 * same horizontal lane as the already-sticky action buttons inside the
 * Viewer card. Single horizontal header.
 *
 * Scrolled, mobile (<640px): pins at top: 52px on its OWN full-width row,
 * directly below the action buttons row. Toolstrip switches to icon-only
 * (no labels) so the diff badges have room.
 *
 * Composes <AnnotationToolstrip compact /> + <DocBadges layout="row" />.
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
  const [isMobile, setIsMobile] = useState(false);

  // Match the `sm` Tailwind breakpoint (640px). Below it the bar lives on
  // its own row and switches the toolstrip to icon-only so the diff
  // badges have room.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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
          sticky lane must sit above that to paint over the card.

          Below sm (640px) — true mobile — the bar pins at top-[52px], on
          its OWN full-width row BELOW the card's sticky action buttons.
          Stacked horizontal lanes, no horizontal collision possible.

          At sm+ the bar shares the top-3 lane with the action buttons
          (single horizontal header). */}
      <div
        className="sticky top-[52px] sm:top-3 z-[60] w-full self-center pointer-events-none"
        style={{ maxWidth, height: 0 }}
      >
        {/* Responsive bar.

            The bar is `inline-flex` with a `max-width` cap (not bounded
            by `right-X`), so its chrome wraps tightly to the toolstrip +
            badges and only extends as far as the content needs.

            Below sm (mobile): max-w leaves a 24px gutter on the right.
            Bar lives on its own row at top-[52px] so there's nothing to
            collide with.

            sm-md (tablet, short-label action buttons): max-w leaves
            340px on the right to clear the action button cluster
            (Attachments "Images" + Comment + Copy ≈ 320px).

            lg+ (desktop, full-label action buttons): max-w leaves 400px
            for the full-label cluster ("Global comment" + "Copy plan"
            ≈ 380px).

            `flex-shrink-0` on the toolstrip wrapper is a defensive
            measure: if a long branch name pushes the badges, this stops
            the toolstrip from being squeezed below its natural width and
            tripping its internal flex-wrap. `overflow-hidden` on the bar
            is the final safety net so any overflow clips inside the
            chrome rather than leaking out.

            `inert` removes the bar from the tab order when not stuck. */}
        <div
          inert={!isStuck || undefined}
          className={`absolute left-3 sm:left-5 lg:left-7 xl:left-9 top-0 inline-flex items-center gap-3 max-w-[calc(100%-24px)] sm:max-w-[calc(100%-340px)] lg:max-w-[calc(100%-400px)] min-w-0 overflow-hidden rounded-lg py-1 md:py-1.5 bg-card/95 backdrop-blur-sm shadow-sm border border-border/30 motion-reduce:transform-none ${
            isStuck
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-1 pointer-events-none'
          }`}
          style={{
            paddingLeft: 12,
            paddingRight: 12,
            transition:
              'opacity 180ms cubic-bezier(0.2, 0, 0, 1), transform 180ms cubic-bezier(0.2, 0, 0, 1)',
            willChange: 'opacity, transform',
          }}
        >
          <div className="flex-shrink-0">
            <AnnotationToolstrip
              inputMethod={inputMethod}
              onInputMethodChange={onInputMethodChange}
              mode={mode}
              onModeChange={onModeChange}
              taterMode={taterMode}
              compact
              iconOnly={isMobile}
            />
          </div>
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
