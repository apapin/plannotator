/**
 * Checklist Server
 *
 * Serves a QA checklist for interactive developer verification.
 * The agent produces structured JSON, this server serves it to
 * the checklist UI and collects per-item pass/fail/skip results.
 *
 * Follows the same patterns as annotate.ts (simplest server).
 *
 * Environment variables:
 *   PLANNOTATOR_REMOTE - Set to "1" or "true" for remote/devcontainer mode
 *   PLANNOTATOR_PORT   - Fixed port to use (default: random locally, 19432 for remote)
 */

import { homedir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { startServer } from "./serve";
import { handleImage, handleUpload, handleServerReady, handleDraftSave, handleDraftLoad, handleDraftDelete } from "./shared-handlers";
import { contentHash, deleteDraft } from "./draft";
import type { Checklist, ChecklistItem, ChecklistPR, ChecklistSubmission, ChecklistItemResult } from "@plannotator/shared/checklist-types";

// Re-export utilities
export { isRemoteSession, getServerPort } from "./remote";
export { openBrowser } from "./browser";
export { handleServerReady as handleChecklistServerReady } from "./shared-handlers";

// Re-export types for consumers
export type { Checklist, ChecklistItem, ChecklistPR, ChecklistSubmission, ChecklistItemResult };

// --- Types ---

export interface ChecklistServerOptions {
  /** Validated checklist JSON from the agent */
  checklist: Checklist;
  /** HTML content to serve for the UI */
  htmlContent: string;
  /** Origin identifier for UI customization */
  origin?: "opencode" | "claude-code" | "pi";
  /** Project name for storage scoping */
  project?: string;
  /** Pre-existing results to restore (from saved checklist files) */
  initialResults?: ChecklistItemResult[];
  /** Pre-existing global notes to restore (from saved checklist files) */
  initialGlobalNotes?: string[];
  /** Called when server starts with the URL, remote status, and port */
  onReady?: (url: string, isRemote: boolean, port: number) => void;
}

export interface ChecklistServerResult {
  /** The port the server is running on */
  port: number;
  /** The full URL to access the server */
  url: string;
  /** Whether running in remote mode */
  isRemote: boolean;
  /** Wait for user checklist submission */
  waitForDecision: () => Promise<ChecklistDecision>;
  /** Stop the server */
  stop: () => void;
}

export interface ChecklistDecision {
  /** Formatted markdown feedback for the agent */
  feedback: string;
  /** Per-item results */
  results: ChecklistItemResult[];
  /** Path where checklist + results were saved */
  savedTo?: string;
  /** Optional agent switch target */
  agentSwitch?: string;
}

// --- Validation ---

/**
 * Validate a checklist JSON object.
 * Returns an array of error messages (empty = valid).
 */
export function validateChecklist(data: unknown): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Checklist must be a JSON object.");
    return errors;
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.title !== "string" || !obj.title.trim()) {
    errors.push('Missing or empty "title" (string).');
  }

  if (typeof obj.summary !== "string" || !obj.summary.trim()) {
    errors.push('Missing or empty "summary" (string).');
  }

  // Validate optional PR field
  if (obj.pr !== undefined) {
    if (typeof obj.pr !== "object" || obj.pr === null) {
      errors.push('"pr" must be an object if provided.');
    } else {
      const pr = obj.pr as Record<string, unknown>;
      if (typeof pr.number !== "number") {
        errors.push('pr.number must be a number.');
      }
      if (typeof pr.url !== "string" || !pr.url) {
        errors.push('pr.url must be a non-empty string.');
      }
      const validProviders = ["github", "gitlab", "azure-devops"];
      if (!validProviders.includes(pr.provider as string)) {
        errors.push(`pr.provider must be one of: ${validProviders.join(", ")}.`);
      }
    }
  }

  if (!Array.isArray(obj.items)) {
    errors.push('"items" must be an array.');
    return errors;
  }

  if (obj.items.length === 0) {
    errors.push('"items" array is empty — include at least one checklist item.');
  }

  for (let i = 0; i < obj.items.length; i++) {
    const item = obj.items[i] as Record<string, unknown>;
    const prefix = `items[${i}]`;

    if (typeof item.id !== "string" || !item.id.trim()) {
      errors.push(`${prefix}: missing "id" (string, e.g. "func-1").`);
    }

    if (typeof item.category !== "string" || !item.category.trim()) {
      errors.push(`${prefix}: missing "category" (string, e.g. "functional").`);
    }

    if (typeof item.check !== "string" || !item.check.trim()) {
      errors.push(`${prefix}: missing "check" (imperative verb phrase).`);
    }

    if (typeof item.description !== "string" || !item.description.trim()) {
      errors.push(`${prefix}: missing "description" (markdown narrative).`);
    }

    if (!Array.isArray(item.steps) || item.steps.length === 0) {
      errors.push(`${prefix}: "steps" must be a non-empty array of strings.`);
    }

    if (typeof item.reason !== "string" || !item.reason.trim()) {
      errors.push(`${prefix}: missing "reason" (why manual verification is needed).`);
    }
  }

  return errors;
}

// --- Feedback Formatting ---

/**
 * Format checklist results as markdown for the agent.
 */
export function formatChecklistFeedback(
  checklist: Checklist,
  results: ChecklistItemResult[],
  globalNotes?: string[] | string,
  automations?: { postToPR?: boolean; approveIfAllPass?: boolean },
): string {
  const resultMap = new Map(results.map((r) => [r.id, r]));

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;

  for (const item of checklist.items) {
    const result = resultMap.get(item.id);
    if (result?.status === "passed") passed++;
    else if (result?.status === "failed") failed++;
    else if (result?.status === "skipped") skipped++;
    else pending++;
  }

  const lines: string[] = [];

  lines.push("# QA Checklist Results");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- **Title**: ${checklist.title}`);
  lines.push(`- **Total**: ${checklist.items.length} items`);
  lines.push(`- **Passed**: ${passed} | **Failed**: ${failed} | **Skipped**: ${skipped}${pending > 0 ? ` | **Pending**: ${pending}` : ""}`);
  lines.push("");

  // Failed items — full detail
  const failedItems = checklist.items.filter(
    (item) => resultMap.get(item.id)?.status === "failed"
  );
  if (failedItems.length > 0) {
    lines.push("## Failed Items");
    lines.push("");
    for (const item of failedItems) {
      const result = resultMap.get(item.id)!;
      lines.push(`### ${item.id}: ${item.check}`);
      lines.push(`**Status**: FAILED`);
      lines.push(`**Category**: ${item.category}`);
      if (item.critical) lines.push(`**Critical**: yes`);
      if (item.files?.length) lines.push(`**Files**: ${item.files.join(", ")}`);
      const itemNotes = Array.isArray(result.notes) ? result.notes : result.notes ? [result.notes] : [];
      for (const note of itemNotes) {
        lines.push(`**Developer notes**: ${note}`);
      }
      if (result.images?.length) {
        for (const img of result.images) {
          lines.push(`[${img.name}] ${img.path}`);
        }
      }
      lines.push("");
    }
  }

  // Skipped items
  const skippedItems = checklist.items.filter(
    (item) => resultMap.get(item.id)?.status === "skipped"
  );
  if (skippedItems.length > 0) {
    lines.push("## Skipped Items");
    lines.push("");
    for (const item of skippedItems) {
      const result = resultMap.get(item.id)!;
      lines.push(`### ${item.id}: ${item.check}`);
      lines.push(`**Status**: SKIPPED`);
      const skipNotes = Array.isArray(result.notes) ? result.notes : result.notes ? [result.notes] : [];
      for (const note of skipNotes) {
        lines.push(`**Reason**: ${note}`);
      }
      lines.push("");
    }
  }

  // Passed items — compact
  const passedItems = checklist.items.filter(
    (item) => resultMap.get(item.id)?.status === "passed"
  );
  if (passedItems.length > 0) {
    lines.push("## Passed Items");
    lines.push("");
    for (const item of passedItems) {
      const result = resultMap.get(item.id);
      const passNotes = Array.isArray(result?.notes) ? result.notes : result?.notes ? [result.notes] : [];
      const notes = passNotes.length > 0 ? ` — ${passNotes.join('; ')}` : "";
      lines.push(`- [PASS] ${item.id}: ${item.check}${notes}`);
    }
    lines.push("");
  }

  // Global notes
  const notes = Array.isArray(globalNotes) ? globalNotes : globalNotes ? [globalNotes] : [];
  if (notes.length > 0) {
    lines.push("## Developer Comments");
    lines.push("");
    for (const note of notes) {
      lines.push(`> ${note.trim().replace(/\n/g, "\n> ")}`);
      lines.push("");
    }
  }

  // Automation instructions
  if (automations && checklist.pr) {
    const pr = checklist.pr;
    const hasAutomations = automations.postToPR || automations.approveIfAllPass;

    if (hasAutomations) {
      lines.push("## Automations");
      lines.push("");

      if (automations.postToPR) {
        if (pr.provider === "github") {
          lines.push("**Post results to PR**: The developer requested that you post these checklist results as a comment on the pull request.");
          lines.push(`Use the \`gh\` CLI to post a comment to PR #${pr.number}:`);
          lines.push("```bash");
          lines.push(`gh pr comment ${pr.number} --body '<checklist results markdown>'`);
          lines.push("```");
          lines.push("If `gh` is not available, inform the developer to install the GitHub CLI (`brew install gh` or https://cli.github.com).");
        } else if (pr.provider === "gitlab") {
          lines.push("**Post results to MR**: The developer requested that you post these checklist results as a comment on the merge request.");
          lines.push(`Use the \`glab\` CLI to post a note to MR !${pr.number}:`);
          lines.push("```bash");
          lines.push(`glab mr note ${pr.number} --message '<checklist results markdown>'`);
          lines.push("```");
          lines.push("If `glab` is not available, inform the developer to install the GitLab CLI (`brew install glab` or https://gitlab.com/gitlab-org/cli).");
        } else if (pr.provider === "azure-devops") {
          lines.push("**Post results to PR**: The developer requested that you post these checklist results as a comment on the pull request.");
          lines.push(`Use the \`az\` CLI to post a comment to PR #${pr.number}:`);
          lines.push("```bash");
          lines.push(`az repos pr update --id ${pr.number} --description '<append checklist results>'`);
          lines.push("```");
          lines.push("If `az` is not available, inform the developer to install Azure CLI (`brew install azure-cli` or https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).");
        }
        lines.push("");
      }

      if (automations.approveIfAllPass && failed === 0 && skipped === 0 && pending === 0) {
        if (pr.provider === "github") {
          lines.push("**Approve PR**: All checklist items passed. The developer requested auto-approval.");
          lines.push(`Use the \`gh\` CLI to approve PR #${pr.number}:`);
          lines.push("```bash");
          lines.push(`gh pr review ${pr.number} --approve --body 'QA checklist passed (${passed}/${passed} items)'`);
          lines.push("```");
        } else if (pr.provider === "gitlab") {
          lines.push("**Approve MR**: All checklist items passed. The developer requested auto-approval.");
          lines.push(`Use the \`glab\` CLI to approve MR !${pr.number}:`);
          lines.push("```bash");
          lines.push(`glab mr approve ${pr.number}`);
          lines.push("```");
        } else if (pr.provider === "azure-devops") {
          lines.push("**Approve PR**: All checklist items passed. The developer requested auto-approval.");
          lines.push(`Use the \`az\` CLI to approve PR #${pr.number}:`);
          lines.push("```bash");
          lines.push(`az repos pr set-vote --id ${pr.number} --vote approve`);
          lines.push("```");
        }
        lines.push("");
      } else if (automations.approveIfAllPass && (failed > 0 || skipped > 0 || pending > 0)) {
        lines.push("**Approve PR**: Skipped — not all items passed. Fix the failed/skipped items and re-run the checklist.");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// --- Storage ---

/**
 * Save a completed checklist (original + results) to disk.
 * Returns the path to the saved file.
 *
 * Structure: ~/.plannotator/checklists/{project}/{slug}.json
 * The saved file contains the full checklist JSON plus results,
 * so it can be reopened via `plannotator checklist --file <path>`.
 */
function saveChecklistResults(
  checklist: Checklist,
  results: ChecklistItemResult[],
  globalNotes: string[] | string | undefined,
  project: string,
): string {
  const dir = join(homedir(), ".plannotator", "checklists", project);
  mkdirSync(dir, { recursive: true });

  const date = new Date().toISOString().split("T")[0];
  const slug = checklist.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const timestamp = Date.now();
  const filename = `${slug}-${date}-${timestamp}.json`;
  const filePath = join(dir, filename);

  writeFileSync(filePath, JSON.stringify({
    checklist,
    results,
    globalNotes,
    submittedAt: new Date().toISOString(),
    project,
  }, null, 2));

  return filePath;
}

// --- Server Implementation ---

/**
 * Start the Checklist server
 *
 * Handles:
 * - Remote detection and port configuration
 * - API routes (/api/checklist, /api/feedback)
 * - Port conflict retries
 */
export async function startChecklistServer(
  options: ChecklistServerOptions
): Promise<ChecklistServerResult> {
  const {
    checklist,
    htmlContent,
    origin,
    project = "_unknown",
    initialResults,
    initialGlobalNotes,
    onReady,
  } = options;

  const draftKey = contentHash(JSON.stringify(checklist));

  // Decision promise
  let resolveDecision: (result: ChecklistDecision) => void;
  const decisionPromise = new Promise<ChecklistDecision>((resolve) => {
    resolveDecision = resolve;
  });

  const { server, port, url: serverUrl, isRemote } = await startServer({
    fetch: async (req) => {
      const url = new URL(req.url);

      // API: Get checklist data
      if (url.pathname === "/api/checklist" && req.method === "GET") {
        return Response.json({
          checklist,
          origin,
          mode: "checklist",
          ...(initialResults && { initialResults }),
          ...(initialGlobalNotes && { initialGlobalNotes }),
        });
      }

      // API: Serve images (local paths or temp uploads)
      if (url.pathname === "/api/image") {
        return handleImage(req);
      }

      // API: Upload image -> save to temp -> return path
      if (url.pathname === "/api/upload" && req.method === "POST") {
        return handleUpload(req);
      }

      // API: Checklist draft persistence
      if (url.pathname === "/api/draft") {
        if (req.method === "POST") return handleDraftSave(req, draftKey);
        if (req.method === "DELETE") return handleDraftDelete(draftKey);
        return handleDraftLoad(draftKey);
      }

      // API: Submit checklist results
      if (url.pathname === "/api/feedback" && req.method === "POST") {
        try {
          const body = (await req.json()) as ChecklistSubmission & {
            agentSwitch?: string;
          };

          deleteDraft(draftKey);

          const results = body.results || [];

          // Save to disk
          let savedTo: string | undefined;
          try {
            savedTo = saveChecklistResults(
              checklist,
              results,
              body.globalNotes,
              project,
            );
          } catch {
            // Non-fatal — feedback still goes to agent
          }

          const feedback = formatChecklistFeedback(
            checklist,
            results,
            body.globalNotes,
            body.automations,
          );

          resolveDecision({
            feedback,
            results,
            savedTo,
            agentSwitch: body.agentSwitch,
          });

          return Response.json({ ok: true });
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process checklist submission";
          return Response.json({ error: message }, { status: 500 });
        }
      }

      // Serve embedded HTML for all other routes (SPA)
      return new Response(htmlContent, {
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  // Notify caller that server is ready
  if (onReady) {
    onReady(serverUrl, isRemote, port);
  }

  return {
    port,
    url: serverUrl,
    isRemote,
    waitForDecision: () => decisionPromise,
    stop: () => server.stop(),
  };
}
