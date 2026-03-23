import type React from 'react';
import { useState, useEffect } from 'react';
import { getProviderMeta } from '@plannotator/ui/components/ProviderIcons';

interface AIProviderModel {
  id: string;
  label: string;
  default?: boolean;
}

interface AIProviderInfo {
  id: string;
  name: string;
  models?: AIProviderModel[];
}

const REASONING_EFFORTS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Max' },
] as const;

interface AIConfigBarProps {
  providers: AIProviderInfo[];
  selectedProviderId: string | null;
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: string | null) => void;
  hasSession: boolean;
}

export const AIConfigBar: React.FC<AIConfigBarProps> = ({
  providers,
  selectedProviderId,
  selectedModel,
  selectedReasoningEffort,
  onProviderChange,
  onModelChange,
  onReasoningEffortChange,
  hasSession,
}) => {
  const [showSessionNote, setShowSessionNote] = useState(false);

  // Flash "New chat session" briefly when config changes while a session exists
  useEffect(() => {
    if (showSessionNote) {
      const t = setTimeout(() => setShowSessionNote(false), 2000);
      return () => clearTimeout(t);
    }
  }, [showSessionNote]);

  if (providers.length === 0) {
    return (
      <div className="border-t border-border/50 px-2 py-1.5 text-[11px] text-muted-foreground/50">
        No AI providers available
      </div>
    );
  }

  const effectiveProviderId = selectedProviderId ?? providers[0]?.id;
  const currentProvider = providers.find(p => p.id === effectiveProviderId) ?? providers[0];
  if (!currentProvider) return null;

  const meta = getProviderMeta(currentProvider.name);
  const Icon = meta.icon;
  const models = currentProvider.models ?? [];
  const defaultModel = models.find(m => m.default) ?? models[0];
  const effectiveModel = selectedModel ?? defaultModel?.id;
  const currentModelLabel = models.find(m => m.id === effectiveModel)?.label ?? defaultModel?.label;

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (hasSession) setShowSessionNote(true);
    onProviderChange(e.target.value);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (hasSession) setShowSessionNote(true);
    onModelChange(e.target.value);
  };

  return (
    <div className="border-t border-border/50 px-2 py-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {/* Provider selector */}
      {providers.length > 1 ? (
        <label className="flex items-center gap-1 cursor-pointer">
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
          <select
            value={effectiveProviderId}
            onChange={handleProviderChange}
            className="bg-transparent text-[11px] text-muted-foreground cursor-pointer focus:outline-none hover:text-foreground transition-colors appearance-none pr-3"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'8\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{getProviderMeta(p.name).label}</option>
            ))}
          </select>
        </label>
      ) : (
        <span className="flex items-center gap-1">
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{meta.label}</span>
        </span>
      )}

      {/* Model selector */}
      {models.length > 1 ? (
        <>
          <span className="text-border">·</span>
          <select
            value={effectiveModel}
            onChange={handleModelChange}
            className="bg-transparent text-[11px] text-muted-foreground cursor-pointer focus:outline-none hover:text-foreground transition-colors appearance-none pr-3"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'8\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </>
      ) : currentModelLabel ? (
        <>
          <span className="text-border">·</span>
          <span>{currentModelLabel}</span>
        </>
      ) : null}

      {/* Reasoning effort — Codex only */}
      {currentProvider.name === 'codex-sdk' && (
        <>
          <span className="text-border">·</span>
          <select
            value={selectedReasoningEffort ?? 'high'}
            onChange={(e) => {
              if (hasSession) setShowSessionNote(true);
              onReasoningEffortChange(e.target.value);
            }}
            className="bg-transparent text-[11px] text-muted-foreground cursor-pointer focus:outline-none hover:text-foreground transition-colors appearance-none pr-3"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'8\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
            title="Reasoning effort"
          >
            {REASONING_EFFORTS.map(e => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Session reset note */}
      {showSessionNote && (
        <span className="text-[10px] text-amber-500 animate-pulse">New chat session</span>
      )}

      {/* Gear placeholder */}
      <button
        type="button"
        className="p-0.5 rounded text-muted-foreground/40 cursor-default"
        title="More settings (coming soon)"
        disabled
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>
  );
};
