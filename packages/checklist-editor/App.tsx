import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ThemeProvider } from '@plannotator/ui/components/ThemeProvider';
import { ConfirmDialog } from '@plannotator/ui/components/ConfirmDialog';
import { CompletionOverlay } from '@plannotator/ui/components/CompletionOverlay';
import { ResizeHandle } from '@plannotator/ui/components/ResizeHandle';
import { CommentPopover } from '@plannotator/ui/components/CommentPopover';
import { useResizablePanel } from '@plannotator/ui/hooks/useResizablePanel';
import { ChecklistHeader } from './components/ChecklistHeader';
import { ChecklistGroup } from './components/ChecklistGroup';
import { ChecklistAnnotationPanel } from './components/ChecklistAnnotationPanel';
import { ProgressBar } from './components/ProgressBar';
import { useChecklistState } from './hooks/useChecklistState';
import { useChecklistProgress } from './hooks/useChecklistProgress';
import { useChecklistDraft } from './hooks/useChecklistDraft';
import { exportChecklistResults } from './utils/exportChecklist';
import type { Checklist, ChecklistItem, ChecklistItemStatus, ChecklistItemResult } from './hooks/useChecklistState';
import type { ChecklistPR } from '@plannotator/shared/checklist-types';
import type { ChecklistAutomations } from './components/ChecklistAnnotationPanel';
import type { ImageAttachment } from '@plannotator/ui/types';

// ---------------------------------------------------------------------------
// Demo Data
// ---------------------------------------------------------------------------

const DEMO_CHECKLIST: Checklist = {
  title: 'Authentication Refactor QA Checklist',
  summary: 'Verify the OAuth2 migration from session-based auth. Focus on token refresh, CSRF protection, and backward compatibility with existing sessions.',
  pr: {
    number: 142,
    url: 'https://github.com/acme/webapp/pull/142',
    title: 'feat: migrate to OAuth2 token-based auth',
    branch: 'feat/oauth2-migration',
    provider: 'github' as const,
  },
  items: [
    {
      id: 'auth-1',
      category: 'Security',
      check: 'CSRF token validation on all state-changing endpoints',
      description: 'The migration replaced session-based CSRF with double-submit cookie pattern. Every POST/PUT/DELETE endpoint must validate the `X-CSRF-Token` header against the `csrf_token` cookie.\n\nCheck that the middleware is applied globally and not just on auth routes.',
      steps: [
        'Open DevTools Network tab',
        'Submit the login form and verify X-CSRF-Token header is present',
        'Try a POST request without the header — should get 403',
        'Verify the csrf_token cookie has SameSite=Strict',
      ],
      reason: 'CSRF protection is security-critical and automated tests may not catch middleware ordering issues.',
      files: ['src/middleware/csrf.ts', 'src/routes/api.ts'],
      critical: true,
    },
    {
      id: 'auth-2',
      category: 'Security',
      check: 'Token refresh handles race conditions',
      description: 'When multiple API calls fire simultaneously and the access token is expired, only one refresh request should be sent. Subsequent calls should queue and use the new token.',
      steps: [
        'Log in and wait for the access token to expire (or manually set it to expired)',
        'Trigger 3+ API calls simultaneously (e.g., navigate to dashboard)',
        'Check Network tab — only one /auth/refresh call should appear',
        'All queued requests should succeed with the refreshed token',
      ],
      reason: 'Race conditions in token refresh can cause cascading 401s and logout the user.',
      files: ['src/lib/api-client.ts', 'src/hooks/useAuth.ts'],
      critical: true,
    },
    {
      id: 'auth-3',
      category: 'Functionality',
      check: 'Login flow completes successfully',
      description: 'Basic end-to-end login with email/password. User should be redirected to their intended destination after authentication.',
      steps: [
        'Navigate to a protected page while logged out',
        'Complete the login form',
        'Verify redirect back to the originally requested page',
        'Check that the user menu shows the correct identity',
      ],
      reason: 'Core user flow that must work correctly.',
      files: ['src/pages/login.tsx', 'src/middleware/auth.ts'],
    },
    {
      id: 'auth-4',
      category: 'Functionality',
      check: 'OAuth provider login (Google, GitHub)',
      description: 'Social login buttons should initiate the OAuth flow and correctly create or link accounts.',
      steps: [
        'Click "Sign in with Google" and complete the OAuth flow',
        'Verify account is created/linked correctly',
        'Repeat with GitHub provider',
        'Try linking a second provider to an existing account',
      ],
      reason: 'OAuth flows involve third-party redirects that are difficult to test automatically.',
      files: ['src/auth/providers.ts'],
    },
    {
      id: 'auth-5',
      category: 'Backward Compatibility',
      check: 'Existing sessions are migrated transparently',
      description: 'Users with active session cookies from the old system should be seamlessly migrated to the new token-based system without being logged out.',
      steps: [
        'Log in using the old build to establish a session cookie',
        'Deploy the new build',
        'Refresh the page — user should remain logged in',
        'Verify the old session cookie is replaced with the new token cookies',
      ],
      reason: 'A forced logout would affect all active users and is unacceptable for a production migration.',
      files: ['src/middleware/session-migration.ts'],
      critical: true,
    },
    {
      id: 'auth-6',
      category: 'Backward Compatibility',
      check: 'API keys continue to work unchanged',
      description: 'Service accounts using API key authentication should be unaffected by the OAuth migration.',
      steps: [
        'Make an API call with a valid API key',
        'Verify the response is identical to the old behavior',
        'Check that API key auth bypasses the OAuth middleware',
      ],
      reason: 'Breaking API key auth would disrupt automated integrations.',
      files: ['src/middleware/api-key.ts'],
    },
    {
      id: 'auth-7',
      category: 'UI/UX',
      check: 'Error states show helpful messages',
      description: 'Invalid credentials, expired links, and rate limiting should show user-friendly error messages, not raw error codes.',
      steps: [
        'Try logging in with wrong credentials — check the error message',
        'Try a password reset with an expired link',
        'Trigger rate limiting (5+ failed attempts) and verify the message',
      ],
      reason: 'Error copy is hard to verify without visual inspection.',
    },
    {
      id: 'auth-8',
      category: 'UI/UX',
      check: 'Loading states during auth operations',
      description: 'Buttons should show loading spinners and be disabled during login, registration, and token refresh to prevent double-submission.',
      steps: [
        'Click login and observe button state before response arrives',
        'Check that double-clicking does not submit twice',
        'Verify there is no layout shift when the spinner appears',
      ],
      reason: 'Loading state polish requires visual verification.',
    },
  ],
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const ChecklistApp: React.FC = () => {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [initialResults, setInitialResults] = useState<ChecklistItemResult[] | undefined>();
  const [initialGlobalNotes, setInitialGlobalNotes] = useState<string[] | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Fetch checklist data
  useEffect(() => {
    fetch('/api/checklist')
      .then(res => {
        if (!res.ok) throw new Error('Not in API mode');
        return res.json();
      })
      .then((data: { checklist: Checklist; origin?: string; initialResults?: ChecklistItemResult[]; initialGlobalNotes?: string[] }) => {
        setChecklist(data.checklist);
        if (data.origin) setOrigin(data.origin);
        if (data.initialResults) setInitialResults(data.initialResults);
        if (data.initialGlobalNotes) setInitialGlobalNotes(data.initialGlobalNotes);
      })
      .catch(() => {
        // Demo mode
        setChecklist(DEMO_CHECKLIST);
      })
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading || !checklist) {
    return (
      <ThemeProvider defaultTheme="dark">
        <div className="h-screen flex items-center justify-center bg-background">
          <div className="text-muted-foreground text-sm">Loading checklist...</div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark">
      <ChecklistAppInner checklist={checklist} origin={origin} initialResults={initialResults} initialGlobalNotes={initialGlobalNotes} />
    </ThemeProvider>
  );
};

// ---------------------------------------------------------------------------
// Inner component
// ---------------------------------------------------------------------------

interface ChecklistAppInnerProps {
  checklist: Checklist;
  origin: string | null;
  initialResults?: ChecklistItemResult[];
  initialGlobalNotes?: string[];
}

// Note popover state
interface NotePopoverState {
  anchorEl: HTMLElement;
  itemId: string | null; // null = global comment
}

const ChecklistAppInner: React.FC<ChecklistAppInnerProps> = ({ checklist, origin, initialResults, initialGlobalNotes }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<'approved' | 'feedback' | false>(false);
  const [globalNotes, setGlobalNotes] = useState<string[]>([]);
  const [showPartialConfirm, setShowPartialConfirm] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null);
  const [automations, setAutomations] = useState<ChecklistAutomations>({ postToPR: false, approveIfAllPass: false });
  const documentRef = useRef<HTMLDivElement>(null);
  const globalCommentButtonRef = useRef<HTMLButtonElement>(null);

  const state = useChecklistState({ items: checklist.items });
  const { counts, categoryProgress, submitState } = useChecklistProgress(checklist.items, state.results);

  const panelResize = useResizablePanel({
    storageKey: 'plannotator-checklist-panel-width',
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 500,
  });

  // Draft auto-save
  const { draftBanner, restoreDraft, dismissDraft } = useChecklistDraft({
    results: state.allResults,
    globalNotes,
    isApiMode: !!origin,
    submitted: !!submitted,
  });

  const handleRestoreDraft = useCallback(() => {
    const restored = restoreDraft();
    if (restored) {
      state.restoreResults(restored.results);
      if (restored.globalNotes) setGlobalNotes(restored.globalNotes);
    }
  }, [restoreDraft, state.restoreResults]);

  // Restore initial results from saved checklist file (--file flag)
  useEffect(() => {
    if (initialResults?.length) {
      state.restoreResults(initialResults);
    }
    if (initialGlobalNotes?.length) {
      setGlobalNotes(initialGlobalNotes);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // One-time on mount

  // Toggle item expansion
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    state.selectItem(id);
  }, [state.selectItem]);

  // Open note popover for an item
  const handleOpenNote = useCallback((anchorEl: HTMLElement, itemId: string) => {
    setNotePopover({ anchorEl, itemId });
  }, []);

  // Open global comment popover
  const handleOpenGlobalComment = useCallback(() => {
    if (globalCommentButtonRef.current) {
      setNotePopover({ anchorEl: globalCommentButtonRef.current, itemId: null });
    }
  }, []);

  // Handle note popover submit
  const handleNoteSubmit = useCallback((text: string, images?: ImageAttachment[]) => {
    if (!notePopover) return;

    if (notePopover.itemId === null) {
      // Global comment — add as new entry
      setGlobalNotes(prev => [...prev, text]);
    } else {
      // Per-item note — add to array
      state.addNote(notePopover.itemId, text);
      if (images && images.length > 0) {
        state.setImages(notePopover.itemId, images.map(img => ({ path: img.path, name: img.name })));
      }
    }

    setNotePopover(null);
  }, [notePopover, state.addNote, state.setImages]);

  const handleNoteClose = useCallback(() => {
    setNotePopover(null);
  }, []);

  // Remove notes
  const handleRemoveItemNote = useCallback((id: string, index: number) => {
    state.removeNote(id, index);
  }, [state.removeNote]);

  const handleRemoveGlobalNote = useCallback((index: number) => {
    setGlobalNotes(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Select item from annotation panel (expand + scroll)
  const handleSelectFromPanel = useCallback((id: string) => {
    setExpandedItems(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    state.selectItem(id);
    // Scroll to item
    if (documentRef.current) {
      const el = documentRef.current.querySelector(`[data-item-id="${id}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [state.selectItem]);

  // Feedback markdown for copy
  const feedbackMarkdown = useMemo(
    () => exportChecklistResults(checklist.items, state.results, globalNotes.length > 0 ? globalNotes : undefined),
    [checklist.items, state.results, globalNotes],
  );

  // Submit
  const handleSubmit = useCallback(async () => {
    if (submitState === 'all-pending') return;

    if (submitState === 'partial' && !showPartialConfirm) {
      setShowPartialConfirm(true);
      return;
    }

    setShowPartialConfirm(false);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: feedbackMarkdown,
          results: state.allResults,
          globalNotes: globalNotes.length > 0 ? globalNotes : undefined,
          automations: checklist.pr ? automations : undefined,
        }),
      });

      if (res.ok) {
        const hasFailures = state.allResults.some(r => r.status === 'failed');
        setSubmitted(hasFailures ? 'feedback' : 'approved');
      } else {
        throw new Error('Failed to submit');
      }
    } catch (err) {
      console.error('Failed to submit checklist:', err);
      setIsSubmitting(false);
    }
  }, [submitState, showPartialConfirm, feedbackMarkdown, state.allResults, checklist.pr, automations]);

  // Keyboard shortcuts — use refs for values that change frequently to avoid
  // tearing down/re-attaching the listener on every state change
  const stateRef = useRef(state);
  stateRef.current = state;
  const submittedRef = useRef(submitted);
  submittedRef.current = submitted;
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      const s = stateRef.current;

      // Cmd+Enter to submit (works even in inputs)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        if (submittedRef.current || isSubmittingRef.current) return;
        if (!origin) return;
        e.preventDefault();
        handleSubmit();
        return;
      }

      // Don't intercept other shortcuts in inputs
      if (isInput) return;

      switch (e.key) {
        case 'j': {
          e.preventDefault();
          const nextId = s.selectNext();
          if (nextId) setExpandedItems(new Set<string>([nextId]));
          break;
        }
        case 'k': {
          e.preventDefault();
          const prevId = s.selectPrev();
          if (prevId) setExpandedItems(new Set<string>([prevId]));
          break;
        }
        case 'p':
          if (s.selectedItemId) {
            e.preventDefault();
            const r = s.getResult(s.selectedItemId);
            s.setStatus(s.selectedItemId, r.status === 'passed' ? 'pending' : 'passed');
          }
          break;
        case 'f':
          if (s.selectedItemId) {
            e.preventDefault();
            const r = s.getResult(s.selectedItemId);
            s.setStatus(s.selectedItemId, r.status === 'failed' ? 'pending' : 'failed');
          }
          break;
        case 's':
          if (s.selectedItemId) {
            e.preventDefault();
            const r = s.getResult(s.selectedItemId);
            s.setStatus(s.selectedItemId, r.status === 'skipped' ? 'pending' : 'skipped');
          }
          break;
        case 'n':
          if (s.selectedItemId) {
            e.preventDefault();
            const itemEl = documentRef.current?.querySelector(`[data-item-id="${s.selectedItemId}"]`);
            const noteBtn = itemEl?.querySelector('[title="Add note (n)"]') as HTMLElement | null;
            if (noteBtn) {
              setNotePopover({ anchorEl: noteBtn, itemId: s.selectedItemId });
            }
          }
          break;
        case 'Enter':
          if (s.selectedItemId) {
            e.preventDefault();
            handleToggleExpand(s.selectedItemId);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [origin, handleSubmit, handleToggleExpand]);

  // Scroll selected item into view
  useEffect(() => {
    if (!state.selectedItemId || !documentRef.current) return;
    const el = documentRef.current.querySelector(`[data-item-id="${state.selectedItemId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.selectedItemId]);

  const agentLabel = origin === 'claude-code' ? 'Claude Code' : origin === 'pi' ? 'Pi' : 'OpenCode';

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <ChecklistHeader
        title={checklist.title}
        origin={origin}
        pr={checklist.pr}
        counts={counts}
        submitState={submitState}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        isPanelOpen={isPanelOpen}
        onTogglePanel={() => setIsPanelOpen(p => !p)}
      />

      {/* Draft restore banner */}
      <ConfirmDialog
        isOpen={!!draftBanner}
        onClose={dismissDraft}
        onConfirm={handleRestoreDraft}
        title="Draft Recovered"
        message={draftBanner ? `Found ${draftBanner.count} reviewed item${draftBanner.count !== 1 ? 's' : ''} from ${draftBanner.timeAgo}. Would you like to restore them?` : ''}
        confirmText="Restore"
        cancelText="Dismiss"
        showCancel
      />

      {/* Main content */}
      <div className={`flex-1 flex overflow-hidden ${panelResize.isDragging ? 'select-none' : ''}`}>
        {/* Checklist document */}
        <div ref={documentRef} className="flex-1 min-w-0 overflow-y-auto bg-grid">
          <div className="checklist-document">
            {/* Title */}
            <h1 className="text-xl font-bold text-foreground mb-1 tracking-tight">{checklist.title}</h1>

            {/* Summary */}
            {checklist.summary && (
              <p className="text-sm text-muted-foreground/80 leading-relaxed mb-3">{checklist.summary}</p>
            )}

            {/* Progress bar */}
            <ProgressBar counts={counts} stopped={!!submitted} />

            {/* Checklist items in glassomorphic surface */}
            <div className="mt-4 bg-muted/50 rounded-lg p-3 border border-border/30">
              {/* Global comment button — inside the surface, right-aligned */}
              <div className="flex justify-end mb-3">
                <button
                  ref={globalCommentButtonRef}
                  onClick={handleOpenGlobalComment}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-card border border-border/50 shadow-sm hover:bg-muted rounded-md transition-colors"
                  title="Add global comment"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                  </svg>
                  <span>Global comment</span>
                </button>
              </div>

              {state.categories.map(category => {
                const items = state.groupedItems.get(category);
                const progress = categoryProgress.get(category);
                if (!items || !progress) return null;
                return (
                  <ChecklistGroup
                    key={category}
                    category={category}
                    items={items}
                    progress={progress}
                    expandedItems={expandedItems}
                    selectedItemId={state.selectedItemId}
                    onToggleExpand={handleToggleExpand}
                    onOpenNote={handleOpenNote}
                    getResult={state.getResult}
                    onSetStatus={state.setStatus}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Resize handle + Annotation panel */}
        {isPanelOpen && (
          <>
            <ResizeHandle {...panelResize.handleProps} />
            <ChecklistAnnotationPanel
              items={checklist.items}
              getResult={state.getResult}
              globalNotes={globalNotes}
              pr={checklist.pr}
              automations={automations}
              onAutomationsChange={setAutomations}
              onSelectItem={handleSelectFromPanel}
              onRemoveItemNote={handleRemoveItemNote}
              onRemoveGlobalNote={handleRemoveGlobalNote}
              width={panelResize.width}
              feedbackMarkdown={feedbackMarkdown}
            />
          </>
        )}
      </div>

      {/* Comment popover */}
      {notePopover && (
        <CommentPopover
          anchorEl={notePopover.anchorEl}
          contextText={notePopover.itemId
            ? checklist.items.find(i => i.id === notePopover.itemId)?.check || ''
            : ''
          }
          isGlobal={notePopover.itemId === null}
          initialText=""
          onSubmit={handleNoteSubmit}
          onClose={handleNoteClose}
        />
      )}

      {/* Partial submit confirmation */}
      <ConfirmDialog
        isOpen={showPartialConfirm}
        onClose={() => setShowPartialConfirm(false)}
        onConfirm={handleSubmit}
        title="Partial Results"
        message={<>{counts.pending} item{counts.pending !== 1 ? 's' : ''} haven't been reviewed yet. Submit anyway?</>}
        confirmText="Submit Partial Results"
        cancelText="Continue Reviewing"
        variant="warning"
        showCancel
      />

      {/* Completion overlay */}
      {origin && (
        <CompletionOverlay
          submitted={submitted}
          title={submitted === 'approved' ? 'All Checks Passed' : 'Results Submitted'}
          subtitle={
            submitted === 'approved'
              ? `${agentLabel} will proceed with confidence.`
              : `${agentLabel} will address the failed checks.`
          }
          agentLabel={agentLabel}
        />
      )}

      {/* Demo mode toast */}
      {!origin && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-popover border border-border shadow-xl text-[10px] text-muted-foreground animate-in fade-in slide-in-from-bottom-2">
          Demo mode — <kbd className="px-1 py-0.5 rounded bg-muted font-mono">j</kbd>/<kbd className="px-1 py-0.5 rounded bg-muted font-mono">k</kbd> navigate, <kbd className="px-1 py-0.5 rounded bg-muted font-mono">p</kbd>/<kbd className="px-1 py-0.5 rounded bg-muted font-mono">f</kbd>/<kbd className="px-1 py-0.5 rounded bg-muted font-mono">s</kbd> set status, <kbd className="px-1 py-0.5 rounded bg-muted font-mono">Enter</kbd> expand
        </div>
      )}
    </div>
  );
};

export default ChecklistApp;
