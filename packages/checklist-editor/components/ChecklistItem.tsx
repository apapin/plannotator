import React, { useRef, useCallback } from 'react';
import type { ChecklistItem as ChecklistItemType, ChecklistItemResult } from '../hooks/useChecklistState';
import { StatusIcon, QuickActions } from './StatusButton';

interface ChecklistItemProps {
  item: ChecklistItemType;
  result: ChecklistItemResult;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onOpenNote: (anchorEl: HTMLElement) => void;
  onSetStatus: (status: ChecklistItemResult['status']) => void;
}

export const ChecklistItem: React.FC<ChecklistItemProps> = ({
  item,
  result,
  isExpanded,
  isSelected,
  onToggleExpand,
  onOpenNote,
  onSetStatus,
}) => {
  const noteButtonRef = useRef<HTMLButtonElement>(null);

  const handleNoteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (noteButtonRef.current) {
      onOpenNote(noteButtonRef.current);
    }
  }, [onOpenNote]);

  const sectionHeading = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5";

  return (
    <div
      data-item-id={item.id}
      className={`checklist-item ${result.status} ${isSelected ? 'selected' : ''} bg-card/50 backdrop-blur-sm rounded-lg border border-border/30 shadow-sm cursor-pointer`}
      onClick={onToggleExpand}
    >
      {/* Top row */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {/* Status icon */}
        <div className="mt-0.5 flex-shrink-0">
          <StatusIcon status={result.status} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Check headline */}
          <div className="text-[15px] font-medium text-foreground leading-snug">
            {item.check}
          </div>

          {/* Badges row */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              {item.category}
            </span>
            {item.critical && (
              <span className="critical-badge">Critical</span>
            )}
          </div>
        </div>

        {/* Quick actions + Note button */}
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
          <QuickActions currentStatus={result.status} onSetStatus={onSetStatus} />
          <button
            ref={noteButtonRef}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              result.notes && result.notes.length > 0
                ? 'text-primary bg-primary/10 hover:bg-primary/15'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={handleNoteClick}
            title="Add note (n)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Note
          </button>
        </div>
      </div>

      {/* Description preview (collapsed only) */}
      {!isExpanded && item.description && (
        <div className="px-3 pb-2.5 -mt-1 pl-[2.125rem]">
          <div className="checklist-item-preview text-xs text-muted-foreground leading-relaxed">
            {item.description}
          </div>
        </div>
      )}

      {/* Expandable body */}
      <div className={`checklist-item-body ${isExpanded ? 'expanded' : ''}`}>
        <div>
          <div className="px-3 pb-3 pl-[2.125rem] space-y-3">
            {/* Description */}
            {item.description && (
              <section>
                <h3 className={sectionHeading}>Description</h3>
                <div className="checklist-description">
                  {renderSimpleMarkdown(item.description)}
                </div>
              </section>
            )}

            {/* Verification steps */}
            {item.steps.length > 0 && (
              <section>
                <h3 className={sectionHeading}>Verification Steps</h3>
                <ol className="verification-steps">
                  {item.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </section>
            )}

            {/* File references */}
            {item.files && item.files.length > 0 && (
              <section>
                <h3 className={sectionHeading}>Files</h3>
                <div className="space-y-0.5">
                  {item.files.map((file, i) => (
                    <div
                      key={i}
                      className="text-xs font-mono text-muted-foreground px-2 py-1 rounded bg-muted/40 truncate"
                      title={file}
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Reason */}
            {item.reason && (
              <section>
                <h3 className={sectionHeading}>Why Manual Verification</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.reason}</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Simple markdown renderer for description text
// ---------------------------------------------------------------------------

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    let match = remaining.match(/^\*\*(.+?)\*\*/);
    if (match) {
      parts.push(<strong key={key++} className="font-semibold">{renderInlineMarkdown(match[1])}</strong>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Inline code: `code`
    match = remaining.match(/^`([^`]+)`/);
    if (match) {
      parts.push(<code key={key++} className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono">{match[1]}</code>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Plain text — consume up to next special character
    match = remaining.match(/^[^*`]+/);
    if (match) {
      parts.push(<span key={key++}>{match[0]}</span>);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Single * or ` that didn't match a pattern — consume one char
    parts.push(<span key={key++}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return <>{parts}</>;
}

function renderSimpleMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCode = false;
  let codeBlock: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) {
        elements.push(<pre key={`code-${i}`}><code>{codeBlock.join('\n')}</code></pre>);
        codeBlock = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBlock.push(line);
      continue;
    }

    if (line.trim() === '') {
      elements.push(<br key={`br-${i}`} />);
      continue;
    }

    elements.push(
      <p key={`p-${i}`}>{renderInlineMarkdown(line)}</p>,
    );
  }

  if (inCode && codeBlock.length > 0) {
    elements.push(<pre key="code-end"><code>{codeBlock.join('\n')}</code></pre>);
  }

  return <>{elements}</>;
}
