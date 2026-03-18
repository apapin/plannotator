/**
 * Build script: reads AUTOMATION.md files and generates a TypeScript module.
 *
 * Usage: bun run packages/automations/build.ts
 * Output: packages/automations/generated.ts (gitignored)
 */

import { readdir, readFile, exists } from "fs/promises";
import { join, resolve } from "path";

interface AutomationTemplate {
  name: string;
  description: string;
  type: "smart-action" | "prompt-hook";
  context: string | string[];
  feedback: string;
  emoji?: string;
  author?: string;
  repo?: string;
  inspiredBy?: { name: string; url: string }[];
  icon?: string; // base64 or inline SVG
  iconType?: "svg" | "png";
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("No frontmatter found");

  const raw = match[1];
  const body = match[2].trim();
  const frontmatter: Record<string, unknown> = {};

  // Simple YAML parser for our known schema
  let currentKey = "";
  let inMetadata = false;
  let inInspiredBy = false;
  let inspiredByList: { name: string; url: string }[] = [];
  const metadata: Record<string, unknown> = {};

  for (const line of raw.split("\n")) {
    if (line === "metadata:") {
      inMetadata = true;
      continue;
    }
    if (inMetadata && line.startsWith("  inspired-by:")) {
      inInspiredBy = true;
      continue;
    }
    if (inInspiredBy && line.startsWith("    - name:")) {
      const name = line.replace("    - name:", "").trim();
      inspiredByList.push({ name, url: "" });
      continue;
    }
    if (inInspiredBy && line.startsWith("      url:")) {
      if (inspiredByList.length > 0) {
        inspiredByList[inspiredByList.length - 1].url = line.replace("      url:", "").trim();
      }
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
    if (inMetadata && !line.startsWith(" ")) {
      inMetadata = false;
    }
    if (!inMetadata) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");
        frontmatter[key] = value;
      }
    }
  }

  if (inInspiredBy) {
    metadata["inspired-by"] = inspiredByList;
  }
  if (Object.keys(metadata).length > 0) {
    frontmatter.metadata = metadata;
  }

  // Handle context as array
  const ctx = frontmatter.context as string;
  if (ctx && ctx.startsWith("[")) {
    frontmatter.context = ctx
      .replace(/[\[\]]/g, "")
      .split(",")
      .map((s: string) => s.trim());
  }

  return { frontmatter, body };
}

async function loadIcon(dir: string): Promise<{ icon?: string; iconType?: "svg" | "png" }> {
  const svgPath = join(dir, "icon.svg");
  if (await exists(svgPath)) {
    const svg = await readFile(svgPath, "utf-8");
    return { icon: svg, iconType: "svg" };
  }
  const pngPath = join(dir, "icon.png");
  if (await exists(pngPath)) {
    const png = await readFile(pngPath);
    const b64 = Buffer.from(png).toString("base64");
    return { icon: `data:image/png;base64,${b64}`, iconType: "png" };
  }
  return {};
}

async function loadAutomationsFromDir(
  contextDir: string,
  contextName: string,
): Promise<AutomationTemplate[]> {
  const automations: AutomationTemplate[] = [];

  let entries: string[];
  try {
    entries = await readdir(contextDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const automationDir = join(contextDir, entry);
    const mdPath = join(automationDir, "AUTOMATION.md");

    if (!(await exists(mdPath))) continue;

    const content = await readFile(mdPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    const meta = (frontmatter.metadata as Record<string, unknown>) || {};

    const { icon, iconType } = await loadIcon(automationDir);

    const template: AutomationTemplate = {
      name: (frontmatter.name as string) || entry,
      description: (frontmatter.description as string) || "",
      type: (frontmatter.type as "smart-action" | "prompt-hook") || "smart-action",
      context: frontmatter.context || contextName,
      feedback: body,
      emoji: meta.emoji as string | undefined,
      author: meta.author as string | undefined,
      repo: meta.repo as string | undefined,
      inspiredBy: meta["inspired-by"] as { name: string; url: string }[] | undefined,
      ...(icon && { icon, iconType }),
    };

    automations.push(template);
  }

  return automations;
}

async function main() {
  const root = resolve(import.meta.dir);
  const planDir = join(root, "plan");
  const reviewDir = join(root, "review");

  const planAutomations = await loadAutomationsFromDir(planDir, "plan");
  const reviewAutomations = await loadAutomationsFromDir(reviewDir, "review");

  const output = `// Auto-generated by packages/automations/build.ts — do not edit
// Source: packages/automations/{plan,review}/*/AUTOMATION.md

export interface AutomationTemplate {
  name: string;
  description: string;
  type: "smart-action" | "prompt-hook";
  context: string | string[];
  feedback: string;
  emoji?: string;
  author?: string;
  repo?: string;
  inspiredBy?: { name: string; url: string }[];
  icon?: string;
  iconType?: "svg" | "png";
}

export const PLAN_LIBRARY: AutomationTemplate[] = ${JSON.stringify(planAutomations, null, 2)};

export const REVIEW_LIBRARY: AutomationTemplate[] = ${JSON.stringify(reviewAutomations, null, 2)};
`;

  const outPath = join(root, "generated.ts");
  await Bun.write(outPath, output);

  console.log(
    `Generated ${outPath}: ${planAutomations.length} plan + ${reviewAutomations.length} review automations`,
  );
}

main().catch(console.error);
