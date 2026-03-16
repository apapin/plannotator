import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getEnabledAutomations, type Automation, type AutomationContext } from '../utils/automations';
import { useDismissOnOutsideAndEscape } from '../hooks/useDismissOnOutsideAndEscape';

interface AutomationsDropdownProps {
  context: AutomationContext;
  onSend: (feedback: string) => Promise<void>;
  disabled?: boolean;
}

export const AutomationsDropdown: React.FC<AutomationsDropdownProps> = ({
  context,
  onSend,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const automations = useMemo(() => getEnabledAutomations(context), [context, open]);

  const handleDismiss = useCallback(() => {
    if (!sendingId) setOpen(false);
  }, [sendingId]);

  useDismissOnOutsideAndEscape({
    enabled: open && !sendingId,
    ref: dropdownRef,
    onDismiss: handleDismiss,
  });

  // Position state
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const handleRowClick = async (automation: Automation) => {
    if (sendingId || disabled) return;
    setSendingId(automation.id);

    // Brief highlight, then fade out and send
    await new Promise(r => setTimeout(r, 150));
    setOpen(false);

    try {
      await onSend(automation.feedback);
    } finally {
      setSendingId(null);
    }
  };

  const handleConfigure = () => {
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent('plannotator:open-settings', { detail: { tab: 'automations' } })
    );
  };

  if (automations.length === 0 && !open) return null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 h-7 rounded-lg px-2 border transition-all ${
          open
            ? 'bg-muted/70 border-border/50 text-foreground'
            : 'bg-muted/50 border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/70'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <SparklesIcon />
        <span className="text-xs font-medium hidden md:inline">Automations</span>
        <ChevronIcon open={open} />
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100]"
          style={{ top: pos.top, right: pos.right }}
          onMouseDown={e => e.stopPropagation()}
        >
          <style>{`
            @keyframes auto-dropdown-in {
              from { opacity: 0; transform: translateY(-4px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            @keyframes auto-row-in {
              from { opacity: 0; transform: translateX(-3px); }
              to   { opacity: 1; transform: translateX(0); }
            }
            @keyframes auto-dropdown-out {
              from { opacity: 1; }
              to   { opacity: 0; }
            }
          `}</style>

          <div
            className="bg-popover border border-border/60 rounded-lg shadow-xl overflow-hidden min-w-[220px] max-w-[280px]"
            style={{
              animation: sendingId
                ? 'auto-dropdown-out 0.12s ease-in forwards'
                : 'auto-dropdown-in 0.12s ease-out',
            }}
          >
            {/* Header */}
            <div className="px-2.5 py-1.5 border-b border-border/30">
              <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                Automations
              </span>
            </div>

            {/* Automation rows */}
            <div className="py-1">
              {automations.length === 0 ? (
                <div className="px-3 py-4 text-center">
                  <div className="text-[11px] text-muted-foreground">No automations configured</div>
                  <button
                    onClick={handleConfigure}
                    className="text-[10px] text-primary hover:underline mt-1"
                  >
                    Set up automations
                  </button>
                </div>
              ) : (
                automations.map((automation, index) => (
                  <div key={automation.id}>
                    <button
                      onClick={() => handleRowClick(automation)}
                      disabled={!!sendingId}
                      className={`group w-full flex items-center gap-2 px-2 py-[5px] text-left transition-colors ${
                        sendingId === automation.id
                          ? 'bg-primary/10'
                          : 'hover:bg-muted/60 active:bg-muted'
                      }`}
                      style={{
                        animationDelay: `${index * 18}ms`,
                        animationName: 'auto-row-in',
                        animationDuration: '0.1s',
                        animationFillMode: 'both',
                        animationTimingFunction: 'ease-out',
                      }}
                    >
                      {/* Accent bar */}
                      <span
                        className="w-[3px] self-stretch rounded-full flex-shrink-0"
                        style={{ backgroundColor: 'var(--secondary)' }}
                      />

                      {/* Icon */}
                      {automation.icon ? (
                        <img
                          src={automation.icon}
                          alt=""
                          className="w-4 h-4 rounded flex-shrink-0 object-cover"
                        />
                      ) : (
                        <span className="text-xs leading-none flex-shrink-0">
                          {automation.emoji || '✨'}
                        </span>
                      )}

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] leading-tight text-foreground/85 group-hover:text-foreground truncate">
                          {automation.name}
                        </div>
                        {automation.description && (
                          <div className="text-[10px] leading-tight text-muted-foreground/50 group-hover:text-muted-foreground/70 truncate">
                            {automation.description}
                          </div>
                        )}
                      </div>

                      {/* Sending indicator */}
                      {sendingId === automation.id && (
                        <span className="text-[9px] text-primary flex-shrink-0">sending...</span>
                      )}
                    </button>

                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border/30">
              <button
                onClick={handleConfigure}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
              >
                <GearIcon />
                <span className="text-[11px] text-muted-foreground/60 hover:text-foreground">
                  Configure...
                </span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

/* ─── Icons ─── */

const SparklesIcon: React.FC = () => (
  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 128 128" fill="none">
    <style>{`
      @keyframes sparkle-idle {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
      }
    `}</style>
    <g style={{ animation: 'sparkle-idle 3s infinite ease-in-out', animationDelay: '0.35s' }}>
      <path
        d="M121.59 60.83l-13.93-4.49c-8.91-2.94-14.13-10.15-16.58-19.21L84.95 7.27c-.16-.59-.55-1.38-1.75-1.38c-1.01 0-1.59.79-1.75 1.38l-6.13 29.87c-2.46 9.06-7.67 16.27-16.58 19.21l-13.93 4.49c-1.97.64-2 3.42-.04 4.09l14.03 4.83c8.88 2.95 14.06 10.15 16.52 19.17l6.14 29.53c.16.59.49 1.65 1.75 1.65c1.33 0 1.59-1.06 1.75-1.65l6.14-29.53c2.46-9.03 7.64-16.23 16.52-19.17l14.03-4.83c1.94-.68 1.91-3.46-.06-4.1z"
        fill="var(--secondary-foreground)"
      />
      <path
        d="M122.91 62.08c-.22-.55-.65-1.03-1.32-1.25l-13.93-4.49c-8.91-2.94-14.13-10.15-16.58-19.21L84.95 7.27c-.09-.34-.41-.96-.78-1.14l1.98 29.97c1.47 13.68 2.73 20.12 13.65 22c9.38 1.62 20.23 3.48 23.11 3.98z"
        fill="var(--secondary-foreground)" opacity={0.7}
      />
    </g>
    <g style={{ animation: 'sparkle-idle 3s infinite ease-in-out', animationDelay: '0.15s' }}>
      <path
        d="M41.81 86.81c-8.33-2.75-9.09-5.85-10.49-11.08l-3.49-12.24c-.21-.79-2.27-.79-2.49 0L22.97 74.8c-1.41 5.21-4.41 9.35-9.53 11.04l-8.16 3.54c-1.13.37-1.15 1.97-.02 2.35l8.22 2.91c5.1 1.69 8.08 5.83 9.5 11.02l2.37 10.82c.22.79 2.27.79 2.48 0l2.78-10.77c1.41-5.22 3.57-9.37 10.5-11.07l7.72-2.91c1.13-.39 1.12-1.99-.02-2.36l-7-2.56z"
        fill="var(--secondary-foreground)"
      />
    </g>
    <g style={{ animation: 'sparkle-idle 3s infinite ease-in-out', animationDelay: '0.5s' }}>
      <path
        d="M59.74 28.14c.56-.19.54-.99-.03-1.15l-7.72-2.08a4.77 4.77 0 0 1-3.34-3.3L45.61 9.06c-.15-.61-1.02-.61-1.17.01l-2.86 12.5a4.734 4.734 0 0 1-3.4 3.37l-7.67 1.99c-.57.15-.61.95-.05 1.15l8.09 2.8c1.45.5 2.57 1.68 3.01 3.15l2.89 11.59c.15.6 1.01.61 1.16 0l2.99-11.63a4.773 4.773 0 0 1 3.04-3.13l8.1-2.72z"
        fill="var(--secondary-foreground)" opacity={0.5}
      />
    </g>
  </svg>
);

const ChevronIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg
    className={`w-3 h-3 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

const GearIcon: React.FC = () => (
  <svg className="w-3.5 h-3.5 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
