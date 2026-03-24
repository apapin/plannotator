/**
 * Note-taking app integrations (Obsidian, Bear, Octarine).
 * Node.js equivalents of packages/server/integrations.ts.
 * Config types, save functions, tag extraction, filename generation
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ObsidianConfig {
	vaultPath: string;
	folder: string;
	plan: string;
	filenameFormat?: string;
	filenameSeparator?: "space" | "dash" | "underscore";
}

export interface BearConfig {
	plan: string;
	customTags?: string;
	tagPosition?: "prepend" | "append";
}

export interface OctarineConfig {
	plan: string;
	workspace: string;
	folder: string;
}

export interface IntegrationResult {
	success: boolean;
	error?: string;
	path?: string;
}

/** Detect project name from git or cwd. Node.js equivalent of packages/server/project.ts */
export function detectProjectNameSync(): string | null {
	try {
		const result = execSync("git rev-parse --show-toplevel", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (result) {
			const { extractRepoName } = require("./project.js");
			const name = extractRepoName(result);
			if (name) return name;
		}
	} catch {
		/* not in a git repo */
	}
	try {
		const { extractDirName } = require("./project.js");
		return extractDirName(process.cwd());
	} catch {
		return null;
	}
}

export function extractTitle(markdown: string): string {
	const h1Match = markdown.match(
		/^#\s+(?:Implementation\s+Plan:|Plan:)?\s*(.+)$/im,
	);
	if (h1Match) {
		return h1Match[1]
			.trim()
			.replace(/[<>:"/\\|?*(){}\[\]#~`]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 50);
	}
	return "Plan";
}

export async function extractTags(markdown: string): Promise<string[]> {
	const tags = new Set<string>(["plannotator"]);
	const projectName = detectProjectNameSync();
	if (projectName) tags.add(projectName);
	const stopWords = new Set([
		"the",
		"and",
		"for",
		"with",
		"this",
		"that",
		"from",
		"into",
		"plan",
		"implementation",
		"overview",
		"phase",
		"step",
		"steps",
	]);
	const h1Match = markdown.match(
		/^#\s+(?:Implementation\s+Plan:|Plan:)?\s*(.+)$/im,
	);
	if (h1Match) {
		h1Match[1]
			.toLowerCase()
			.replace(/[^\w\s-]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2 && !stopWords.has(w))
			.slice(0, 3)
			.forEach((w) => tags.add(w));
	}
	const seenLangs = new Set<string>();
	let langMatch: RegExpExecArray | null;
	const langRegex = /```(\w+)/g;
	while ((langMatch = langRegex.exec(markdown)) !== null) {
		const lang = langMatch[1];
		const n = lang.toLowerCase();
		if (
			!seenLangs.has(n) &&
			!["json", "yaml", "yml", "text", "txt", "markdown", "md"].includes(n)
		) {
			seenLangs.add(n);
			tags.add(n);
		}
	}
	return Array.from(tags).slice(0, 7);
}

export function generateFrontmatter(tags: string[]): string {
	const now = new Date().toISOString();
	const tagList = tags.map((t) => t.toLowerCase()).join(", ");
	return `---\ncreated: ${now}\nsource: plannotator\ntags: [${tagList}]\n---`;
}

const DEFAULT_FILENAME_FORMAT = "{title} - {Mon} {D}, {YYYY} {h}-{mm}{ampm}";

export function generateFilename(
	markdown: string,
	format?: string,
	separator?: "space" | "dash" | "underscore",
): string {
	const title = extractTitle(markdown);
	const now = new Date();
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const hour24 = now.getHours();
	const hour12 = hour24 % 12 || 12;
	const ampm = hour24 >= 12 ? "pm" : "am";
	const vars: Record<string, string> = {
		title,
		YYYY: String(now.getFullYear()),
		MM: String(now.getMonth() + 1).padStart(2, "0"),
		DD: String(now.getDate()).padStart(2, "0"),
		Mon: months[now.getMonth()],
		D: String(now.getDate()),
		HH: String(hour24).padStart(2, "0"),
		h: String(hour12),
		hh: String(hour12).padStart(2, "0"),
		mm: String(now.getMinutes()).padStart(2, "0"),
		ss: String(now.getSeconds()).padStart(2, "0"),
		ampm,
	};
	const template = format?.trim() || DEFAULT_FILENAME_FORMAT;
	const result = template.replace(
		/\{(\w+)\}/g,
		(match, key) => vars[key] ?? match,
	);
	let sanitized = result
		.replace(/[<>:"/\\|?*]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (separator === "dash") sanitized = sanitized.replace(/ /g, "-");
	else if (separator === "underscore") sanitized = sanitized.replace(/ /g, "_");
	return sanitized.endsWith(".md") ? sanitized : `${sanitized}.md`;
}

export async function saveToObsidian(
	config: ObsidianConfig,
): Promise<IntegrationResult> {
	try {
		const { vaultPath, folder, plan } = config;
		let normalizedVault = vaultPath.trim();
		if (normalizedVault.startsWith("~")) {
			const home = process.env.HOME || process.env.USERPROFILE || "";
			normalizedVault = join(home, normalizedVault.slice(1));
		}
		if (!existsSync(normalizedVault))
			return {
				success: false,
				error: `Vault path does not exist: ${normalizedVault}`,
			};
		if (!statSync(normalizedVault).isDirectory())
			return {
				success: false,
				error: `Vault path is not a directory: ${normalizedVault}`,
			};
		const folderName = folder.trim() || "plannotator";
		const targetFolder = join(normalizedVault, folderName);
		if (!existsSync(targetFolder)) mkdirSync(targetFolder, { recursive: true });
		const filename = generateFilename(
			plan,
			config.filenameFormat,
			config.filenameSeparator,
		);
		const filePath = join(targetFolder, filename);
		const tags = await extractTags(plan);
		const frontmatter = generateFrontmatter(tags);
		const content = `${frontmatter}\n\n[[Plannotator Plans]]\n\n${plan}`;
		writeFileSync(filePath, content);
		return { success: true, path: filePath };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
}

export function stripH1(plan: string): string {
	return plan.replace(/^#\s+.+\n?/m, "").trimStart();
}

export function buildHashtags(
	customTags: string | undefined,
	autoTags: string[],
): string {
	if (customTags?.trim())
		return customTags
			.split(",")
			.map((t) => `#${t.trim()}`)
			.filter((t) => t !== "#")
			.join(" ");
	return autoTags.map((t) => `#${t}`).join(" ");
}

export function buildBearContent(
	body: string,
	hashtags: string,
	tagPosition: "prepend" | "append",
): string {
	return tagPosition === "prepend"
		? `${hashtags}\n\n${body}`
		: `${body}\n\n${hashtags}`;
}

export async function saveToBear(
	config: BearConfig,
): Promise<IntegrationResult> {
	try {
		const { plan, customTags, tagPosition = "append" } = config;
		const title = extractTitle(plan);
		const body = stripH1(plan);
		const tags = customTags?.trim() ? undefined : await extractTags(plan);
		const hashtags = buildHashtags(customTags, tags ?? []);
		const content = buildBearContent(body, hashtags, tagPosition);
		const url = `bear://x-callback-url/create?title=${encodeURIComponent(title)}&text=${encodeURIComponent(content)}&open_note=no`;
		spawn("open", [url], { stdio: "ignore" });
		return { success: true };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
}

export function generateOctarineFrontmatter(tags: string[]): string {
	const now = new Date().toISOString().slice(0, 16);
	const tagLines = tags.map((t) => `  - ${t.toLowerCase()}`).join("\n");
	return `---\ntags:\n${tagLines}\nStatus: Draft\nAuthor: plannotator\nLast Edited: ${now}\n---`;
}

export async function saveToOctarine(
	config: OctarineConfig,
): Promise<IntegrationResult> {
	try {
		const { plan } = config;
		const workspace = config.workspace.trim();
		if (!workspace) return { success: false, error: "Workspace is required" };
		const folder = config.folder.trim() || "plannotator";
		const filename = generateFilename(plan);
		const base = filename.replace(/\.md$/, "");
		const path = folder ? `${folder}/${base}` : base;
		const tags = await extractTags(plan);
		const frontmatter = generateOctarineFrontmatter(tags);
		const content = `${frontmatter}\n\n${plan}`;
		const url = `octarine://create?path=${encodeURIComponent(path)}&content=${encodeURIComponent(content)}&workspace=${encodeURIComponent(workspace)}&fresh=true&openAfter=false`;
		spawn("open", [url], { stdio: "ignore" });
		return { success: true, path };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
}
