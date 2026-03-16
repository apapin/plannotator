/**
 * Automations — preset feedback messages for one-click agent interaction
 *
 * Plan and review automations are stored separately — different cookie keys,
 * different defaults, different library catalogs. The UI component is shared
 * but each context manages its own data.
 */

import { storage } from './storage';

export type AutomationContext = 'plan' | 'review';

const STORAGE_KEYS: Record<AutomationContext, string> = {
  plan: 'plannotator-automations-plan',
  review: 'plannotator-automations-review',
};

export interface Automation {
  id: string;
  name: string;
  emoji?: string;
  icon?: string;
  description?: string;
  feedback: string;
  source: 'custom' | 'library';
  author?: string;
  repoUrl?: string;
  inspiredBy?: { name: string; url: string }[];
  enabled: boolean;
}

export const DEFAULT_PLAN_AUTOMATIONS: Automation[] = [
  {
    id: 'expand-plan',
    name: 'Expand on this',
    emoji: '🔭',
    description: 'Ask for more detail and depth',
    feedback: 'This plan needs more detail. For each major step:\n- Break it into concrete sub-steps\n- Specify which files will be modified\n- Describe the expected behavior after changes\n- Call out any assumptions that need verification',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'add-error-handling',
    name: 'Add error handling',
    emoji: '🛡️',
    description: 'Consider edge cases and failure modes',
    feedback: 'Review this plan for missing error handling and edge cases:\n- What happens when inputs are invalid or missing?\n- What are the failure modes for external calls (network, disk, APIs)?\n- Are there race conditions or concurrency issues?\n- What should the user see when something goes wrong?\n\nAdd concrete error handling steps to the plan.',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'simplify-approach',
    name: 'Simplify the approach',
    emoji: '✂️',
    description: 'Reduce complexity, remove over-engineering',
    feedback: 'This plan is over-engineered. Simplify it:\n- Remove abstractions that only have one consumer\n- Prefer inline code over utility functions for one-off operations\n- Cut any features not explicitly requested\n- Identify the minimal set of changes needed to achieve the goal\n\nResubmit with the simplest approach that works.',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'add-test-strategy',
    name: 'Add test strategy',
    emoji: '🧪',
    description: 'Include testing approach in the plan',
    feedback: 'This plan is missing a testing strategy. Add:\n- Which functions/components need unit tests?\n- Are there integration tests needed?\n- What are the key test cases (happy path, edge cases, error cases)?\n- How will you verify the changes work end-to-end?',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'security-review',
    name: 'Security review',
    emoji: '🔒',
    description: 'Check for security vulnerabilities',
    feedback: 'Review this for security issues:\n- Input validation and sanitization\n- Authentication and authorization gaps\n- Data exposure or leakage risks\n- Injection vulnerabilities (SQL, XSS, command injection)\n- Secrets or credentials handling\n\nFlag any issues found and propose fixes.',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'check-consistency',
    name: 'Check consistency',
    emoji: '🧬',
    description: 'Ensure patterns match existing codebase',
    feedback: 'Before proceeding, verify that this approach is consistent with the existing codebase:\n- Search for similar patterns already in use\n- Match naming conventions, file organization, and code style\n- Reuse existing utilities, helpers, and components where possible\n- Do not introduce new patterns when existing ones work fine',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'document-decisions',
    name: 'Document decisions',
    emoji: '📝',
    description: 'Add reasoning for key choices',
    feedback: 'This plan makes several decisions without explaining why. For each significant choice:\n- What alternatives were considered?\n- Why was this approach chosen over the alternatives?\n- What are the trade-offs?\n- Under what conditions should this decision be revisited?',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
];

export const DEFAULT_REVIEW_AUTOMATIONS: Automation[] = [
  {
    id: 'add-error-handling',
    name: 'Add error handling',
    emoji: '🛡️',
    description: 'Consider edge cases and failure modes',
    feedback: 'Review this code for missing error handling and edge cases:\n- What happens when inputs are invalid or missing?\n- What are the failure modes for external calls (network, disk, APIs)?\n- Are there race conditions or concurrency issues?\n- What should the user see when something goes wrong?\n\nAdd concrete error handling to address these.',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'security-review',
    name: 'Security review',
    emoji: '🔒',
    description: 'Check for security vulnerabilities',
    feedback: 'Review this code for security issues:\n- Input validation and sanitization\n- Authentication and authorization gaps\n- Data exposure or leakage risks\n- Injection vulnerabilities (SQL, XSS, command injection)\n- Secrets or credentials handling\n\nFlag any issues found and propose fixes.',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'check-consistency',
    name: 'Check consistency',
    emoji: '🧬',
    description: 'Ensure patterns match existing codebase',
    feedback: 'Before proceeding, verify that this code is consistent with the existing codebase:\n- Search for similar patterns already in use\n- Match naming conventions, file organization, and code style\n- Reuse existing utilities, helpers, and components where possible\n- Do not introduce new patterns when existing ones work fine',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'performance-check',
    name: 'Performance check',
    emoji: '⚡',
    description: 'Identify performance bottlenecks',
    feedback: 'Analyze this code for performance issues:\n- Are there unnecessary re-renders or recomputations?\n- Any N+1 queries or redundant API calls?\n- Large data structures being copied when they could be mutated?\n- Missing memoization or caching opportunities?\n\nPropose specific optimizations.',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
  {
    id: 'accessibility-review',
    name: 'Accessibility review',
    emoji: '♿',
    description: 'Check for a11y compliance',
    feedback: 'Review for accessibility:\n- Are all interactive elements keyboard accessible?\n- Do images have alt text?\n- Is there proper ARIA labeling?\n- Does color contrast meet WCAG AA?\n- Can screen readers navigate the UI logically?',
    source: 'library',
    author: 'plannotator',
    enabled: true,
  },
];

const DEFAULTS: Record<AutomationContext, Automation[]> = {
  plan: DEFAULT_PLAN_AUTOMATIONS,
  review: DEFAULT_REVIEW_AUTOMATIONS,
};

/** Full catalog for the library browser, per context. Superset of defaults. */
export const LIBRARY_AUTOMATIONS: Record<AutomationContext, Automation[]> = {
  plan: [
    ...DEFAULT_PLAN_AUTOMATIONS,
    {
      id: 'break-into-phases',
      name: 'Break into phases',
      emoji: '🪜',
      description: 'Split into incremental milestones',
      feedback: 'This plan tries to do too much at once. Break it into phases:\n- Phase 1: minimal viable change that works end-to-end\n- Phase 2+: incremental additions building on Phase 1\n\nEach phase should be independently shippable and testable.',
      source: 'library',
      author: 'plannotator',
      enabled: true,
    },
    {
      id: 'performance-plan',
      name: 'Performance check',
      emoji: '⚡',
      description: 'Identify performance concerns in the approach',
      feedback: 'Analyze this plan for performance concerns:\n- Will any step introduce O(n²) or worse complexity?\n- Are there unnecessary data copies or transformations?\n- Will this add latency to the critical path?\n- Are there caching or memoization opportunities?\n\nCall out specific risks and propose mitigations.',
      source: 'library',
      author: 'plannotator',
      enabled: true,
    },
    {
      id: 'backwards-compat',
      name: 'Backwards compatibility',
      emoji: '🔗',
      description: 'Check for breaking changes',
      feedback: 'Review this plan for backwards compatibility:\n- Will any public APIs change signature or behavior?\n- Are there database migrations that could break rollback?\n- Will existing users/consumers need to change anything?\n- Is there a migration path for existing data?\n\nFlag any breaking changes and propose a migration strategy.',
      source: 'library',
      author: 'plannotator',
      enabled: true,
    },
  ],
  review: [
    ...DEFAULT_REVIEW_AUTOMATIONS,
    {
      id: 'naming-review',
      name: 'Naming review',
      emoji: '🏷️',
      description: 'Check variable and function names',
      feedback: 'Review the naming in this code:\n- Are variable/function names descriptive and accurate?\n- Do names match the domain language?\n- Are there abbreviations that should be spelled out?\n- Are boolean variables named as questions (is/has/should)?\n\nSuggest specific renames where names are unclear or misleading.',
      source: 'library',
      author: 'plannotator',
      enabled: true,
    },
    {
      id: 'type-safety',
      name: 'Type safety',
      emoji: '🔷',
      description: 'Check for type-safety gaps',
      feedback: 'Review this code for type safety:\n- Are there any `any` types that should be narrowed?\n- Are type assertions (as) justified or masking issues?\n- Are union types handled exhaustively?\n- Could stricter types prevent bugs at compile time?',
      source: 'library',
      author: 'plannotator',
      enabled: true,
    },
    {
      id: 'cleanup-review',
      name: 'Dead code check',
      emoji: '🧹',
      description: 'Find unused code and imports',
      feedback: 'Check this diff for dead code:\n- Are there unused imports?\n- Any functions or variables defined but never called?\n- Commented-out code that should be removed?\n- Unreachable code paths?\n\nFlag anything that should be cleaned up.',
      source: 'library',
      author: 'plannotator',
      enabled: true,
    },
  ],
};

export function getAutomations(context: AutomationContext): Automation[] {
  const raw = storage.getItem(STORAGE_KEYS[context]);
  if (!raw) return DEFAULTS[context];
  try {
    const parsed = JSON.parse(raw) as Automation[];
    return parsed.length > 0 ? parsed : DEFAULTS[context];
  } catch {
    return DEFAULTS[context];
  }
}

export function saveAutomations(context: AutomationContext, automations: Automation[]): void {
  storage.setItem(STORAGE_KEYS[context], JSON.stringify(automations));
}

export function resetAutomations(context: AutomationContext): void {
  storage.removeItem(STORAGE_KEYS[context]);
}

export function getEnabledAutomations(context: AutomationContext): Automation[] {
  return getAutomations(context).filter(a => a.enabled);
}
