import React, { useState, useRef, useCallback } from 'react';
import {
  type Automation,
  type AutomationContext,
  LIBRARY_AUTOMATIONS,
  resetAutomations,
  DEFAULT_PLAN_AUTOMATIONS,
  DEFAULT_REVIEW_AUTOMATIONS,
} from '../utils/automations';

interface AutomationsSettingsProps {
  context: AutomationContext;
  automations: Automation[];
  onChange: (automations: Automation[]) => void;
}

export const AutomationsSettings: React.FC<AutomationsSettingsProps> = ({
  context,
  automations,
  onChange,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const update = useCallback((index: number, patch: Partial<Automation>) => {
    const updated = [...automations];
    updated[index] = { ...updated[index], ...patch };
    onChange(updated);
  }, [automations, onChange]);

  const updateDebounced = useCallback((index: number, patch: Partial<Automation>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const updated = [...automations];
    updated[index] = { ...updated[index], ...patch };
    onChange(updated);
  }, [automations, onChange]);

  const remove = useCallback((index: number) => {
    const updated = automations.filter((_, i) => i !== index);
    onChange(updated);
    if (automations[index]?.id === expandedId) setExpandedId(null);
  }, [automations, onChange, expandedId]);

  const addCustom = useCallback(() => {
    const newAutomation: Automation = {
      id: `custom-${Date.now()}`,
      name: 'New automation',
      emoji: '✨',
      feedback: '',
      source: 'custom',
      enabled: true,
    };
    onChange([...automations, newAutomation]);
    setExpandedId(newAutomation.id);
  }, [automations, onChange]);

  const addFromLibrary = useCallback((libraryItem: Automation) => {
    const clone: Automation = { ...libraryItem, id: `${libraryItem.id}-${Date.now()}` };
    onChange([...automations, clone]);
  }, [automations, onChange]);

  const defaults = context === 'plan' ? DEFAULT_PLAN_AUTOMATIONS : DEFAULT_REVIEW_AUTOMATIONS;

  const handleReset = useCallback(() => {
    resetAutomations(context);
    onChange(defaults);
    setExpandedId(null);
  }, [context, defaults, onChange]);

  const availableLibrary = LIBRARY_AUTOMATIONS[context].filter(
    lib => !automations.some(a => a.id === lib.id || a.id.startsWith(`${lib.id}-`))
  );

  return (
    <>
      <style>{`
        @keyframes auto-detail-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes auto-lib-row-in {
          from { opacity: 0; transform: translateX(-3px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            {context === 'plan' ? 'Plan' : 'Code Review'} Automations
            <span className="text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary/15 text-primary leading-none">
              beta
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Preset feedback for {context === 'plan' ? 'plan review' : 'code review'}
          </div>
        </div>
        <button
          onClick={handleReset}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset to defaults
        </button>
      </div>

      {/* Automations list */}
      <div className="space-y-1.5">
        {automations.map((automation, index) => {
          const isExpanded = expandedId === automation.id;
          return (
            <AutomationCard
              key={automation.id}
              automation={automation}
              isExpanded={isExpanded}
              onToggleExpand={() => setExpandedId(isExpanded ? null : automation.id)}
              onUpdate={patch => update(index, patch)}
              onUpdateDebounced={patch => updateDebounced(index, patch)}
              onRemove={() => remove(index)}
            />
          );
        })}
      </div>

      {/* Add button */}
      <button
        onClick={addCustom}
        className="w-full py-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg hover:border-foreground/30 transition-colors"
      >
        + Add automation
      </button>

      {/* Library */}
      {availableLibrary.length > 0 && (
        <div className="border-t border-border/30 pt-4 mt-2">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <div className="text-sm font-medium">Library</div>
              <div className="text-[10px] text-muted-foreground/60">
                Community automations you can add
              </div>
            </div>
          </div>
          <div className="space-y-1">
            {availableLibrary.map((item, i) => (
              <button
                key={item.id}
                onClick={() => addFromLibrary(item)}
                className="group w-full flex items-center gap-2 px-2 py-[6px] rounded-lg text-left transition-colors hover:bg-muted/60 active:bg-muted"
                style={{
                  animationDelay: `${i * 18}ms`,
                  animationName: 'auto-lib-row-in',
                  animationDuration: '0.1s',
                  animationFillMode: 'both',
                  animationTimingFunction: 'ease-out',
                }}
              >
                <span
                  className="w-[3px] self-stretch rounded-full flex-shrink-0 opacity-40 group-hover:opacity-70 transition-opacity"
                  style={{ backgroundColor: 'var(--primary)' }}
                />
                <span className="text-xs leading-none flex-shrink-0">{item.emoji || '✨'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] leading-tight text-foreground/85 group-hover:text-foreground truncate">
                    {item.name}
                  </div>
                  {item.description && (
                    <div className="text-[10px] leading-tight text-muted-foreground/50 group-hover:text-muted-foreground/70 truncate">
                      {item.description}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-primary/60 group-hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  + Add
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-muted-foreground/70">
        Click an automation in the dropdown above the {context === 'plan' ? 'plan' : 'diff'} to send its feedback instantly.
      </div>
    </>
  );
};

/* ─── Automation Card ─── */

const AutomationCard: React.FC<{
  automation: Automation;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<Automation>) => void;
  onUpdateDebounced: (patch: Partial<Automation>) => void;
  onRemove: () => void;
}> = ({ automation, isExpanded, onToggleExpand, onUpdate, onUpdateDebounced, onRemove }) => {
  return (
    <div
      className={`rounded-lg overflow-hidden transition-all duration-150 ${
        isExpanded ? 'ring-1 ring-primary/25' : ''
      }`}
      style={{
        backgroundColor: isExpanded
          ? 'oklch(from var(--primary) l c h / 0.06)'
          : 'oklch(from var(--muted) l c h / 0.5)',
      }}
    >
      {/* Collapsed row — click anywhere to expand */}
      <div
        className="flex items-center gap-2 p-2 cursor-pointer"
        onClick={onToggleExpand}
      >
        {/* Icon or emoji */}
        {automation.icon ? (
          <img src={automation.icon} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <span className="text-sm flex-shrink-0">{automation.emoji || '✨'}</span>
        )}

        {/* Name + description */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{automation.name}</div>
          {automation.description && !isExpanded && (
            <div className="text-[10px] text-muted-foreground/60 truncate">{automation.description}</div>
          )}
        </div>

        {/* Status indicators */}
        {!isExpanded && (
          <>
            {!automation.feedback && (
              <span className="text-[9px] text-amber-500/70 flex-shrink-0">no feedback</span>
            )}
            <span className={`text-[10px] font-medium flex-shrink-0 ${
              automation.enabled ? 'text-primary' : 'text-muted-foreground/40'
            }`}>
              {automation.enabled ? 'On' : 'Off'}
            </span>
          </>
        )}

        {/* Chevron */}
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div
          className="px-3 pb-3 space-y-3"
          style={{ animation: 'auto-detail-in 0.12s ease-out' }}
          onClick={e => e.stopPropagation()}
        >
          {/* ── Identity section ── */}
          <FieldGroup label="Identity">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={automation.emoji || ''}
                onChange={e => onUpdate({ emoji: e.target.value || undefined })}
                placeholder="✨"
                className="w-10 px-1.5 py-1 bg-background/80 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <input
                type="text"
                value={automation.name}
                onChange={e => onUpdate({
                  name: e.target.value,
                  id: automation.source === 'custom'
                    ? e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || automation.id
                    : automation.id,
                })}
                autoFocus={automation.name === 'New automation'}
                onFocus={e => { if (automation.name === 'New automation') e.target.select(); }}
                placeholder="Automation name"
                className="flex-1 px-2 py-1 bg-background/80 rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <input
              type="text"
              value={automation.description || ''}
              onChange={e => onUpdate({ description: e.target.value || undefined })}
              placeholder="Short description shown in dropdown"
              className="w-full px-2 py-1 bg-background/80 rounded text-[10px] text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {/* Custom icon */}
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={automation.icon || ''}
                onChange={e => onUpdate({ icon: e.target.value || undefined })}
                placeholder="Custom icon URL (replaces emoji)"
                className="flex-1 px-2 py-1 bg-background/80 rounded text-[10px] text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              {automation.icon && (
                <img
                  src={automation.icon}
                  alt=""
                  className="w-5 h-5 rounded object-cover flex-shrink-0 border border-border/30"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
            </div>
          </FieldGroup>

          {/* ── Feedback section ── */}
          <FieldGroup label="Feedback text">
            <textarea
              value={automation.feedback}
              onChange={e => onUpdateDebounced({ feedback: e.target.value })}
              placeholder="The markdown feedback that gets sent to the agent when this automation is triggered..."
              rows={4}
              className="w-full px-2 py-1.5 bg-background/80 rounded text-[10px] font-mono text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y leading-relaxed"
              autoFocus={!automation.feedback}
            />
          </FieldGroup>

          {/* ── Attribution section (collapsed by default) ── */}
          <AttributionSection
            automation={automation}
            onUpdate={onUpdate}
          />

          {/* ── Footer controls ── */}
          <div className="flex items-center justify-between pt-1 border-t border-border/20">
            <button
              onClick={onRemove}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/50">
                {automation.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                onClick={() => onUpdate({ enabled: !automation.enabled })}
                className={`relative w-8 h-4 rounded-full flex-shrink-0 transition-colors ${
                  automation.enabled ? 'bg-primary' : 'bg-muted-foreground/20'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                    automation.enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Field Group ─── */

const FieldGroup: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className="space-y-1.5">
    <div className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
      {label}
    </div>
    {children}
  </div>
);

/* ─── Attribution Section ─── */

const AttributionSection: React.FC<{
  automation: Automation;
  onUpdate: (patch: Partial<Automation>) => void;
}> = ({ automation, onUpdate }) => {
  const [open, setOpen] = useState(false);
  const hasAttribution = !!(automation.repoUrl || automation.inspiredBy?.length);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="uppercase tracking-wider font-medium">Attribution</span>
        {hasAttribution && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary/50" />
        )}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2.5 pl-4" style={{ animation: 'auto-detail-in 0.1s ease-out' }}>
          <div>
            <div className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">Repository</div>
            <input
              type="text"
              value={automation.repoUrl || ''}
              onChange={e => onUpdate({ repoUrl: e.target.value || undefined })}
              placeholder="https://github.com/user/repo"
              className="w-full px-2 py-1 bg-background/80 rounded text-[10px] text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div>
            <div className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">Inspired by</div>
            <InspiredByEditor
              links={automation.inspiredBy || []}
              onChange={links => onUpdate({ inspiredBy: links.length > 0 ? links : undefined })}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Inspired By ─── */

const InspiredByEditor: React.FC<{
  links: { name: string; url: string }[];
  onChange: (links: { name: string; url: string }[]) => void;
}> = ({ links, onChange }) => {
  const addLink = () => onChange([...links, { name: '', url: '' }]);
  const removeLink = (i: number) => onChange(links.filter((_, idx) => idx !== i));
  const updateLink = (i: number, patch: Partial<{ name: string; url: string }>) => {
    const updated = [...links];
    updated[i] = { ...updated[i], ...patch };
    onChange(updated);
  };

  return (
    <div>
      {links.map((link, i) => (
        <div key={i} className="flex items-center gap-1.5 mb-1">
          <input
            type="text"
            value={link.name}
            onChange={e => updateLink(i, { name: e.target.value })}
            placeholder="Name"
            className="w-20 px-2 py-1 bg-background/80 rounded text-[10px] text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <input
            type="text"
            value={link.url}
            onChange={e => updateLink(i, { url: e.target.value })}
            placeholder="https://..."
            className="flex-1 px-2 py-1 bg-background/80 rounded text-[10px] text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={() => removeLink(i)}
            className="p-0.5 text-muted-foreground/30 hover:text-destructive transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <button
        onClick={addLink}
        className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
      >
        + Inspired by link
      </button>
    </div>
  );
};
