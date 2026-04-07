import React, { useLayoutEffect, useState, useRef } from 'react';
import { useScrollViewport } from '../hooks/useScrollViewport';

interface PinpointOverlayProps {
  target: { element: HTMLElement; label: string } | null;
  containerRef: React.RefObject<HTMLElement | null>;
}

interface OverlayPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const PinpointOverlay: React.FC<PinpointOverlayProps> = ({ target, containerRef }) => {
  const [position, setPosition] = useState<OverlayPosition | null>(null);
  const rafRef = useRef<number>(0);
  const scrollViewport = useScrollViewport();

  useLayoutEffect(() => {
    if (!target || !containerRef.current) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const containerRect = containerRef.current!.getBoundingClientRect();
      const targetRect = target.element.getBoundingClientRect();

      setPosition({
        top: targetRect.top - containerRect.top,
        left: targetRect.left - containerRect.left,
        width: targetRect.width,
        height: targetRect.height,
      });
    };

    updatePosition();

    const handleUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };

    // The scroll element is the OverlayScrollArea viewport. Falling back to
    // <main> or window would attach to the wrong node and the overlay
    // position would drift silently on scroll.
    if (!scrollViewport) return;
    scrollViewport.addEventListener('scroll', handleUpdate, { passive: true });
    window.addEventListener('resize', handleUpdate, { passive: true });

    return () => {
      cancelAnimationFrame(rafRef.current);
      scrollViewport.removeEventListener('scroll', handleUpdate);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [target, containerRef, scrollViewport]);

  if (!position || !target) return null;

  return (
    <>
      {/* Outline box */}
      <div
        className="border-2 border-dashed border-primary/50 bg-primary/5 rounded"
        style={{
          position: 'absolute',
          top: position.top - 2,
          left: position.left - 2,
          width: position.width + 4,
          height: position.height + 4,
          pointerEvents: 'none',
          zIndex: 20,
          transition: 'all 100ms ease-out',
        }}
      />
      {/* Label badge */}
      <div
        style={{
          position: 'absolute',
          top: position.top - 22,
          left: position.left - 2,
          pointerEvents: 'none',
          zIndex: 21,
          transition: 'all 100ms ease-out',
        }}
      >
        <span className="inline-block text-[10px] leading-4 px-1.5 rounded-sm bg-primary text-primary-foreground font-mono whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis">
          {target.label}
        </span>
      </div>
    </>
  );
};
