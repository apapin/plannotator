import React, { useMemo, useState, useEffect } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { AgentJobInfo, CodeAnnotation } from '@plannotator/ui/types';
import { isTerminalStatus } from '@plannotator/shared/agent-jobs';
import { useReviewState } from '../ReviewStateContext';

/**
 * Center dock panel showing full detail for a single agent job.
 * Displays all AgentJobInfo fields + linked annotations.
 */
export const ReviewAgentJobDetailPanel: React.FC<IDockviewPanelProps> = (props) => {
  const jobId: string = props.params?.jobId ?? '';
  const state = useReviewState();

  const job = useMemo(
    () => state.agentJobs.find((j) => j.id === jobId) ?? null,
    [state.agentJobs, jobId]
  );

  const linkedAnnotations = useMemo(
    () =>
      job
        ? (state.externalAnnotations.filter(
            (a) => a.source === job.source
          ) as CodeAnnotation[])
        : [],
    [state.externalAnnotations, job]
  );

  if (!job) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Job not found
      </div>
    );
  }

  const handleAnnotationClick = (ann: CodeAnnotation) => {
    state.openDiffFile(ann.filePath);
    state.onSelectAnnotation(ann.id);
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border/50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <JobStatusBadge status={job.status} />
          <JobProviderBadge provider={job.provider} />
          {!isTerminalStatus(job.status) && (
            <span className="text-xs text-muted-foreground ml-auto">
              <JobElapsedTime startedAt={job.startedAt} />
            </span>
          )}
        </div>
        <h2 className="text-sm font-semibold text-foreground">{job.label}</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Metadata */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Details</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Source</dt>
            <dd className="font-mono text-foreground">{job.source}</dd>

            <dt className="text-muted-foreground">Command</dt>
            <dd className="font-mono text-foreground truncate" title={job.command.join(' ')}>{job.command.join(' ')}</dd>

            <dt className="text-muted-foreground">Started</dt>
            <dd className="text-foreground">{new Date(job.startedAt).toLocaleTimeString()}</dd>

            {job.endedAt && (
              <>
                <dt className="text-muted-foreground">Ended</dt>
                <dd className="text-foreground">{new Date(job.endedAt).toLocaleTimeString()}</dd>
              </>
            )}

            {job.endedAt && (
              <>
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="text-foreground">{formatDuration(job.endedAt - job.startedAt)}</dd>
              </>
            )}

            {job.exitCode !== undefined && (
              <>
                <dt className="text-muted-foreground">Exit code</dt>
                <dd className={`font-mono ${job.exitCode === 0 ? 'text-success' : 'text-destructive'}`}>
                  {job.exitCode}
                </dd>
              </>
            )}
          </dl>
        </section>

        {/* Stderr */}
        {job.error && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Stderr
            </h3>
            <pre className="text-[11px] leading-relaxed font-mono bg-muted/50 border border-border/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-48">
              {job.error}
            </pre>
          </section>
        )}

        {/* Linked Annotations */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Annotations ({linkedAnnotations.length})
          </h3>
          {linkedAnnotations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {isTerminalStatus(job.status)
                ? 'No annotations were produced by this job.'
                : 'Annotations will appear here as the agent produces them.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {linkedAnnotations.map((ann) => (
                <button
                  key={ann.id}
                  className="w-full text-left p-2 rounded-md border border-transparent hover:border-border/50 hover:bg-muted/30 transition-colors"
                  onClick={() => handleAnnotationClick(ann)}
                >
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="font-mono text-primary truncate">{ann.filePath}</span>
                    <span className="text-muted-foreground">L{ann.lineStart}{ann.lineEnd !== ann.lineStart ? `-${ann.lineEnd}` : ''}</span>
                    <span className={`px-1.5 py-0.5 rounded font-medium uppercase tracking-wider ${
                      ann.type === 'concern' ? 'bg-destructive/15 text-destructive' :
                      ann.type === 'suggestion' ? 'bg-success/15 text-success' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {ann.type}
                    </span>
                  </div>
                  {ann.text && (
                    <p className="text-xs text-foreground mt-1 line-clamp-2">{ann.text}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Output placeholder */}
        {!isTerminalStatus(job.status) && linkedAnnotations.length === 0 && (
          <section className="text-xs text-muted-foreground/60 text-center py-4 border border-dashed border-border/30 rounded-md">
            Agent output will appear as annotations in the diff.
          </section>
        )}
      </div>
    </div>
  );
};

// --- Small helper components (mirrors from AgentsTab, kept local) ---

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function JobElapsedTime({ startedAt }: { startedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatDuration(Date.now() - startedAt)}</>;
}

function JobStatusBadge({ status }: { status: AgentJobInfo['status'] }) {
  const config: Record<string, { className: string; label: string }> = {
    starting: { className: 'text-primary', label: 'Starting' },
    running: { className: 'text-primary', label: 'Running' },
    done: { className: 'text-success', label: 'Done' },
    failed: { className: 'text-destructive', label: 'Failed' },
    killed: { className: 'text-muted-foreground', label: 'Killed' },
  };
  const c = config[status] ?? config.killed;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${c.className}`}>
      {(status === 'starting' || status === 'running') && (
        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {c.label}
    </span>
  );
}

function JobProviderBadge({ provider }: { provider: string }) {
  const label = provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : 'Shell';
  return (
    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
      {label}
    </span>
  );
}
