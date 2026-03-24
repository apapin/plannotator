/**
 * Plannotator CLI adapter for Gemini CLI
 *
 * Spawned by a BeforeTool hook on exit_plan_mode.
 * Reads hook event from stdin, resolves the plan file from disk,
 * opens the Plannotator review UI, and returns a Gemini-format
 * decision to stdout.
 *
 * Requires a user policy that grants `decision = "allow"` for
 * exit_plan_mode so the TUI dialog is skipped and this hook
 * becomes the sole approval gate.
 */

import {
  startPlannotatorServer,
  handleServerReady,
} from "@plannotator/server";
import { writeRemoteShareLink } from "@plannotator/server/share-url";
import { registerSession, unregisterSession } from "@plannotator/server/sessions";
import { detectProjectName } from "@plannotator/server/project";
import { planDenyFeedback } from "@plannotator/shared/feedback-templates";
import path from "path";

// Reuse the plan review HTML built by apps/hook
// @ts-ignore - Bun import attribute for text
import planHtml from "../../hook/dist/index.html" with { type: "text" };
const planHtmlContent = planHtml as unknown as string;

// Cleanup session on exit
process.on("exit", () => unregisterSession());

const sharingEnabled = process.env.PLANNOTATOR_SHARE !== "disabled";
const shareBaseUrl = process.env.PLANNOTATOR_SHARE_URL || undefined;
const pasteApiUrl = process.env.PLANNOTATOR_PASTE_URL || undefined;

// --- Read Gemini BeforeTool hook event from stdin ---

const eventJson = await Bun.stdin.text();

let event: {
  tool_name: string;
  tool_input: { plan_path?: string };
  cwd: string;
  session_id?: string;
};

try {
  event = JSON.parse(eventJson);
} catch {
  console.error("Failed to parse hook event from stdin");
  process.exit(1);
}

if (!event.tool_input?.plan_path) {
  console.error("No plan_path in tool_input");
  process.exit(1);
}

// Gemini provides a file path, not inline content — read from disk
const planFilePath = path.resolve(event.cwd, event.tool_input.plan_path);
let planContent: string;
try {
  planContent = await Bun.file(planFilePath).text();
} catch {
  console.error(`Failed to read plan file: ${planFilePath}`);
  process.exit(1);
}

if (!planContent.trim()) {
  console.error("Plan file is empty");
  process.exit(1);
}

// --- Start the plan review server ---

const planProject = (await detectProjectName()) ?? "_unknown";

const server = await startPlannotatorServer({
  plan: planContent,
  origin: "gemini-cli",
  sharingEnabled,
  shareBaseUrl,
  pasteApiUrl,
  htmlContent: planHtmlContent,
  onReady: async (url, isRemote, port) => {
    handleServerReady(url, isRemote, port);

    if (isRemote && sharingEnabled) {
      await writeRemoteShareLink(planContent, shareBaseUrl, "review the plan", "plan only").catch(() => {});
    }
  },
});

registerSession({
  pid: process.pid,
  port: server.port,
  url: server.url,
  mode: "plan",
  project: planProject,
  startedAt: new Date().toISOString(),
  label: `plan-${planProject}`,
});

// Block until user approves or denies in the browser UI
const result = await server.waitForDecision();

// Give browser time to receive response and update UI
await Bun.sleep(1500);

server.stop();

// --- Output Gemini-format decision to stdout ---

if (result.approved) {
  // If the user approved with feedback, surface it as a systemMessage
  // so the model sees it alongside the approval.
  if (result.feedback) {
    console.log(JSON.stringify({ systemMessage: result.feedback }));
  } else {
    console.log("{}");
  }
} else {
  console.log(
    JSON.stringify({
      decision: "deny",
      reason: planDenyFeedback(result.feedback || "", "exit_plan_mode", {
        planFilePath: event.tool_input.plan_path,
      }),
    })
  );
}

process.exit(0);
