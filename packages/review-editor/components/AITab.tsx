import React, { useRef, useEffect, useState, useMemo, memo } from 'react';
import type { AIChatEntry, PendingPermission } from '../hooks/useAIChat';
import { renderMarkdown } from '../utils/renderMarkdown';
import { formatLineRange } from '../utils/formatLineRange';
import { formatTimestamp } from '../utils/formatTimestamp';
import { SparklesIcon } from './SparklesIcon';
import { CountBadge } from './CountBadge';
import { CopyButton } from './CopyButton';
import { PermissionCard } from './PermissionCard';
import { submitHint } from '../utils/platform';

interface AITabProps {
  messages: AIChatEntry[];
  isCreatingSession: boolean;
  isStreaming: boolean;
  activeFilePath?: string;
  scrollToQuestionId?: string | null;
  onScrollToLines: (filePath: string, lineStart: number, lineEnd: number, side: 'old' | 'new') => void;
  onAskGeneral?: (question: string) => void;
  permissionRequests?: PendingPermission[];
  onRespondToPermission?: (requestId: string, allow: boolean) => void;
}

interface FileGroup {
  filePath: string;
  messages: AIChatEntry[];
}

function getQuestionScope(q: AIChatEntry['question']): 'general' | 'file' | 'line' {
  if (!q.filePath) return 'general';
  if (q.lineStart == null) return 'file';
  return 'line';
}

export const AITab: React.FC<AITabProps> = ({
  messages,
  isCreatingSession,
  isStreaming,
  activeFilePath,
  scrollToQuestionId,
  onScrollToLines,
  onAskGeneral,
  permissionRequests = [],
  onRespondToPermission,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [generalInput, setGeneralInput] = useState('');
  const [highlightFilePath, setHighlightFilePath] = useState<string | null>(null);

  // Group messages by file
  const { fileGroups, generalMessages } = useMemo(() => {
    const grouped = new Map<string, AIChatEntry[]>();
    const general: AIChatEntry[] = [];

    for (const msg of messages) {
      if (!msg.question.filePath) {
        general.push(msg);
      } else {
        const existing = grouped.get(msg.question.filePath) || [];
        existing.push(msg);
        grouped.set(msg.question.filePath, existing);
      }
    }

    const fileGroups: FileGroup[] = [];
    for (const [filePath, msgs] of grouped) {
      msgs.sort((a, b) => {
        const aScope = getQuestionScope(a.question);
        const bScope = getQuestionScope(b.question);
        if (aScope !== bScope) return aScope === 'file' ? -1 : 1;
        return (a.question.lineStart ?? 0) - (b.question.lineStart ?? 0);
      });
      fileGroups.push({ filePath, messages: msgs });
    }

    return { fileGroups, generalMessages: general };
  }, [messages]);

  // Auto-expand active file's group
  useEffect(() => {
    if (activeFilePath) {
      setExpandedFiles(prev => {
        if (prev.has(activeFilePath)) return prev;
        const next = new Set(prev);
        next.add(activeFilePath);
        return next;
      });
    }
  }, [activeFilePath]);

  // Scroll to specific question and flash-highlight its file group header
  useEffect(() => {
    if (!scrollToQuestionId || !scrollRef.current) return;

    const msg = messages.find(m => m.question.id === scrollToQuestionId);
    const filePath = msg?.question.filePath;

    if (filePath) {
      const header = scrollRef.current.querySelector(`[data-file-group="${CSS.escape(filePath)}"]`);
      if (header) {
        header.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setHighlightFilePath(filePath);
      setTimeout(() => setHighlightFilePath(null), 1200);
    }

    if (filePath && expandedFiles.has(filePath)) {
      setTimeout(() => {
        const el = scrollRef.current?.querySelector(`[data-question-id="${scrollToQuestionId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [scrollToQuestionId]);

  // Auto-scroll when new messages arrive (not on every streaming token)
  const prevMsgCount = useRef(messages.length);
  useEffect(() => {
    if (!scrollRef.current) return;
    const isNewMessage = messages.length > prevMsgCount.current;
    prevMsgCount.current = messages.length;

    if (isNewMessage) {
      const allQAs = scrollRef.current.querySelectorAll('[data-question-id]');
      const lastQA = allQAs[allQAs.length - 1];
      if (lastQA) {
        lastQA.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  }, [messages.length]);

  const toggleFile = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const handleGeneralSubmit = () => {
    if (!generalInput.trim() || !onAskGeneral) return;
    onAskGeneral(generalInput.trim());
    setGeneralInput('');
  };

  // Empty state
  if (messages.length === 0 && !isCreatingSession) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-4 py-12 text-center">
          <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mb-3">
            <SparklesIcon className="w-5 h-5" />
          </div>
          <p className="text-xs">
            Select lines and click <strong>Ask AI</strong>, or ask a general question below.
          </p>
        </div>
        {onAskGeneral && <GeneralInput value={generalInput} onChange={setGeneralInput} onSubmit={handleGeneralSubmit} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
        {isCreatingSession && messages.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            <span className="ai-streaming-cursor" /> Starting AI session...
          </div>
        )}

        {/* File-grouped questions */}
        {fileGroups.map(({ filePath, messages: fileMessages }) => {
          const isExpanded = expandedFiles.has(filePath);
          const basename = filePath.split('/').pop() || filePath;

          return (
            <div key={filePath} className="mb-1">
              <button
                data-file-group={filePath}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs hover:bg-muted transition-colors ${highlightFilePath === filePath ? 'ai-file-group-highlight' : ''}`}
                onClick={() => toggleFile(filePath)}
              >
                <svg
                  className={`w-3 h-3 text-muted-foreground/50 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="truncate text-foreground font-medium">{basename}</span>
                <CountBadge count={fileMessages.length} className="ml-auto flex-shrink-0 text-muted-foreground/50" />
              </button>

              {isExpanded && (
                <div className="ml-3 border-l border-border/30 pl-2 space-y-2 mt-1">
                  {fileMessages.map(({ question, response }) => (
                    <QAPair key={question.id} question={question} response={response} onScrollToLines={onScrollToLines} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Pending permission requests */}
        {permissionRequests.filter(p => !p.decided).map(perm => (
          <div key={perm.requestId} className="mb-2">
            <PermissionCard
              requestId={perm.requestId}
              toolName={perm.toolName}
              toolInput={perm.toolInput}
              title={perm.title}
              displayName={perm.displayName}
              description={perm.description}
              onRespond={onRespondToPermission ?? (() => {})}
            />
          </div>
        ))}

        {/* General questions */}
        {generalMessages.length > 0 && (
          <div className="mb-3 mt-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              General
            </div>
            <div className="space-y-2 mt-1">
              {generalMessages.map(({ question, response }) => (
                <QAPair key={question.id} question={question} response={response} onScrollToLines={onScrollToLines} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* General question input */}
      {onAskGeneral && <GeneralInput value={generalInput} onChange={setGeneralInput} onSubmit={handleGeneralSubmit} />}
    </div>
  );
};

/** General question input pinned at bottom */
const GeneralInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}> = ({ value, onChange, onSubmit }) => (
  <div className="border-t border-border/50 p-2">
    <div className="flex gap-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ask about the overall changes..."
        rows={1}
        className="flex-1 px-2.5 py-1.5 bg-muted rounded-md text-xs text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim()}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        title={`Send (${submitHint})`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
      </button>
    </div>
  </div>
);

/** Single Q&A pair — memoized to avoid re-parsing markdown on sibling updates */
const QAPair = memo<{
  question: AIChatEntry['question'];
  response: AIChatEntry['response'];
  onScrollToLines: AITabProps['onScrollToLines'];
}>(({ question, response, onScrollToLines }) => {
  const scope = getQuestionScope(question);
  const renderedResponse = useMemo(
    () => response.text ? renderMarkdown(response.text) : null,
    [response.text],
  );

  return (
    <div data-question-id={question.id} className="flex flex-col gap-1.5">
      {/* Question */}
      <div className="p-2.5 rounded-lg border border-transparent hover:bg-muted/30 transition-colors">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            {scope === 'line' && question.filePath && question.lineStart != null && question.lineEnd != null && (
              <button
                className="ai-line-ref"
                onClick={() => onScrollToLines(question.filePath!, question.lineStart!, question.lineEnd!, question.side ?? 'new')}
              >
                {formatLineRange(question.lineStart, question.lineEnd)}
              </button>
            )}
            {scope === 'file' && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                file
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground/50">
            {formatTimestamp(question.createdAt)}
          </span>
        </div>
        <p className="text-xs text-foreground/80">{question.prompt}</p>
      </div>

      {/* Response */}
      <div className="group relative p-2.5 rounded-lg border border-border/50 bg-popover/50 hover:bg-muted/30 transition-colors">
        {response.error ? (
          <p className="text-xs text-destructive">{response.error}</p>
        ) : response.text ? (
          <>
            <div className="text-xs review-comment-body">
              {renderedResponse}
              {response.isStreaming && <span className="ai-streaming-cursor inline-block ml-0.5" />}
            </div>
            {!response.isStreaming && <CopyButton text={response.text} />}
          </>
        ) : response.isStreaming ? (
          <span className="text-xs text-muted-foreground">
            <span className="ai-streaming-cursor" /> Thinking...
          </span>
        ) : null}
      </div>
    </div>
  );
});
