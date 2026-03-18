/**
 * Server-side automations module.
 *
 * Loads the bundled library (from generated.ts at compile time),
 * merges with user automations from ~/.plannotator/automations/,
 * and exposes CRUD operations + state management.
 */

import { readdir, readFile, mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type AutomationType = "smart-action" | "prompt-hook";
export type AutomationContext = "plan" | "review";

export interface AutomationEntry {
  id: string;
  name: string;
  description: string;
  type: AutomationType;
  context: AutomationContext;
  feedback: string;
  emoji?: string;
  author?: string;
  repo?: string;
  inspiredBy?: { name: string; url: string }[];
  icon?: string;
  iconType?: "svg" | "png";
  source: "library" | "custom";
  enabled: boolean;
}

interface AutomationState {
  plan: { enabled: string[]; disabled: string[]; order: string[] };
  review: { enabled: string[]; disabled: string[]; order: string[] };
}

const AUTOMATIONS_DIR = join(homedir(), ".plannotator", "automations");
const STATE_FILE = join(AUTOMATIONS_DIR, "state.json");

/* ─── Frontmatter Parser ─── */

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content.trim() };

  const raw = match[1];
  const body = match[2].trim();
  const frontmatter: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  let inMetadata = false;
  let inInspiredBy = false;
  const inspiredByList: { name: string; url: string }[] = [];

  for (const line of raw.split("\n")) {
    if (line === "metadata:") { inMetadata = true; continue; }
    if (inMetadata && line.startsWith("  inspired-by:")) { inInspiredBy = true; continue; }
    if (inInspiredBy && line.startsWith("    - name:")) {
      inspiredByList.push({ name: line.replace("    - name:", "").trim(), url: "" });
      continue;
    }
    if (inInspiredBy && line.startsWith("      url:") && inspiredByList.length > 0) {
      inspiredByList[inspiredByList.length - 1].url = line.replace("      url:", "").trim();
      continue;
    }
    if (inInspiredBy && !line.startsWith("    ")) {
      inInspiredBy = false;
      metadata["inspired-by"] = inspiredByList;
    }
    if (inMetadata && line.startsWith("  ") && !line.startsWith("    ")) {
      const [k, ...v] = line.trim().split(":");
      metadata[k.trim()] = v.join(":").trim().replace(/^["']|["']$/g, "");
      continue;
    }
    if (inMetadata && !line.startsWith(" ")) { inMetadata = false; }
    if (!inMetadata) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");
        frontmatter[key] = value;
      }
    }
  }

  if (inInspiredBy) metadata["inspired-by"] = inspiredByList;
  if (Object.keys(metadata).length > 0) frontmatter.metadata = metadata;

  return { frontmatter, body };
}

/* ─── Serialize to AUTOMATION.md ─── */

function serializeAutomation(entry: AutomationEntry): string {
  let yaml = `---\nname: ${entry.name}\ndescription: ${entry.description}\ntype: ${entry.type}\ncontext: ${entry.context}\n`;

  const metaLines: string[] = [];
  if (entry.emoji) metaLines.push(`  emoji: "${entry.emoji}"`);
  if (entry.author) metaLines.push(`  author: ${entry.author}`);
  if (entry.repo) metaLines.push(`  repo: ${entry.repo}`);
  if (entry.inspiredBy?.length) {
    metaLines.push("  inspired-by:");
    for (const link of entry.inspiredBy) {
      metaLines.push(`    - name: ${link.name}`);
      metaLines.push(`      url: ${link.url}`);
    }
  }
  if (metaLines.length > 0) yaml += `metadata:\n${metaLines.join("\n")}\n`;

  yaml += "---\n\n";
  yaml += entry.feedback;
  yaml += "\n";
  return yaml;
}

/* ─── State ─── */

async function readState(): Promise<AutomationState> {
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      plan: { enabled: [], disabled: [], order: [] },
      review: { enabled: [], disabled: [], order: [] },
    };
  }
}

async function writeState(state: AutomationState): Promise<void> {
  await mkdir(AUTOMATIONS_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ─── Load User Automations from Disk ─── */

async function loadUserAutomations(context: AutomationContext): Promise<AutomationEntry[]> {
  const dir = join(AUTOMATIONS_DIR, context);
  if (!existsSync(dir)) return [];

  const entries: AutomationEntry[] = [];
  let dirEntries: string[];
  try {
    dirEntries = await readdir(dir);
  } catch {
    return [];
  }

  for (const name of dirEntries) {
    const mdPath = join(dir, name, "AUTOMATION.md");
    try {
      const content = await readFile(mdPath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);
      const meta = (frontmatter.metadata as Record<string, unknown>) || {};

      // Check for icon files
      let icon: string | undefined;
      let iconType: "svg" | "png" | undefined;
      const svgPath = join(dir, name, "icon.svg");
      const pngPath = join(dir, name, "icon.png");
      if (existsSync(svgPath)) {
        icon = await readFile(svgPath, "utf-8");
        iconType = "svg";
      } else if (existsSync(pngPath)) {
        const png = await readFile(pngPath);
        icon = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
        iconType = "png";
      }

      entries.push({
        id: (frontmatter.name as string) || name,
        name: (frontmatter.name as string) || name,
        description: (frontmatter.description as string) || "",
        type: (frontmatter.type as AutomationType) || "smart-action",
        context,
        feedback: body,
        emoji: meta.emoji as string | undefined,
        author: meta.author as string | undefined,
        repo: meta.repo as string | undefined,
        inspiredBy: meta["inspired-by"] as { name: string; url: string }[] | undefined,
        icon,
        iconType,
        source: "custom",
        enabled: true,
      });
    } catch {
      // Skip malformed files
    }
  }

  return entries;
}

/* ─── Main API ─── */

export interface AutomationsResponse {
  automations: AutomationEntry[];
  library: AutomationEntry[];
}

export async function getAutomations(
  context: AutomationContext,
  bundledLibrary: AutomationEntry[],
): Promise<AutomationsResponse> {
  const state = await readState();
  const ctxState = state[context];
  const userAutomations = await loadUserAutomations(context);

  // Merge: user files override library items with same name
  const userNames = new Set(userAutomations.map(a => a.name));
  const effectiveLibrary = bundledLibrary.filter(a => !userNames.has(a.name));
  const allAutomations = [...userAutomations, ...effectiveLibrary];

  // Apply state
  for (const a of allAutomations) {
    if (ctxState.disabled.includes(a.id)) a.enabled = false;
    else if (ctxState.enabled.includes(a.id)) a.enabled = true;
  }

  // Apply ordering
  if (ctxState.order.length > 0) {
    const orderMap = new Map(ctxState.order.map((id, i) => [id, i]));
    allAutomations.sort((a, b) => {
      const ai = orderMap.get(a.id) ?? 999;
      const bi = orderMap.get(b.id) ?? 999;
      return ai - bi;
    });
  }

  // Library items available to add (not already in user's set)
  const activeNames = new Set(allAutomations.map(a => a.name));
  const availableLibrary = bundledLibrary.filter(a => !activeNames.has(a.name));

  return { automations: allAutomations, library: availableLibrary };
}

export async function saveAutomation(
  context: AutomationContext,
  entry: AutomationEntry,
): Promise<void> {
  const dir = join(AUTOMATIONS_DIR, context, entry.name);
  await mkdir(dir, { recursive: true });
  const md = serializeAutomation(entry);
  await writeFile(join(dir, "AUTOMATION.md"), md);
}

export async function deleteAutomation(
  context: AutomationContext,
  name: string,
): Promise<void> {
  const dir = join(AUTOMATIONS_DIR, context, name);
  if (existsSync(dir)) {
    await rm(dir, { recursive: true });
  }

  // Also remove from state
  const state = await readState();
  const ctxState = state[context];
  ctxState.enabled = ctxState.enabled.filter(id => id !== name);
  ctxState.disabled = ctxState.disabled.filter(id => id !== name);
  ctxState.order = ctxState.order.filter(id => id !== name);
  await writeState(state);
}

export async function resetAutomations(context: AutomationContext): Promise<void> {
  const dir = join(AUTOMATIONS_DIR, context);
  if (existsSync(dir)) {
    await rm(dir, { recursive: true });
  }

  // Clear state for this context
  const state = await readState();
  state[context] = { enabled: [], disabled: [], order: [] };
  await writeState(state);
}

export async function updateState(
  context: AutomationContext,
  update: { enabled?: string[]; disabled?: string[]; order?: string[] },
): Promise<void> {
  const state = await readState();
  if (update.enabled) state[context].enabled = update.enabled;
  if (update.disabled) state[context].disabled = update.disabled;
  if (update.order) state[context].order = update.order;
  await writeState(state);
}

/* ─── Convert Bundled Templates to Entries ─── */

export function templateToEntry(
  template: { name: string; description: string; type: string; context: string | string[]; feedback: string; emoji?: string; author?: string; repo?: string; inspiredBy?: { name: string; url: string }[]; icon?: string; iconType?: string },
  context: AutomationContext,
): AutomationEntry {
  return {
    id: template.name,
    name: template.name,
    description: template.description,
    type: template.type as AutomationType,
    context,
    feedback: template.feedback,
    emoji: template.emoji,
    author: template.author,
    repo: template.repo,
    inspiredBy: template.inspiredBy,
    icon: template.icon,
    iconType: template.iconType as "svg" | "png" | undefined,
    source: "library",
    enabled: true,
  };
}
