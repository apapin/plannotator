/**
 * Document and reference handlers (Node.js equivalents of packages/server/reference-handlers.ts).
 * VaultNode, buildFileTree, walkMarkdownFiles, handleDocRequest,
 * detectObsidianVaults, handleObsidian*, handleFileBrowserRequest
 */

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import type { ServerResponse } from "node:http";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

import { json } from "./helpers";

type Res = ServerResponse;

interface VaultNode {
	name: string;
	path: string;
	type: "file" | "folder";
	children?: VaultNode[];
}

function buildFileTree(relativePaths: string[]): VaultNode[] {
	const root: VaultNode[] = [];
	for (const filePath of relativePaths) {
		const parts = filePath.split("/");
		let current = root;
		let pathSoFar = "";
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
			const isFile = i === parts.length - 1;
			let node = current.find(
				(n) => n.name === part && n.type === (isFile ? "file" : "folder"),
			);
			if (!node) {
				node = {
					name: part,
					path: pathSoFar,
					type: isFile ? "file" : "folder",
				};
				if (!isFile) node.children = [];
				current.push(node);
			}
			if (!isFile) current = node.children!;
		}
	}
	const sortNodes = (nodes: VaultNode[]) => {
		nodes.sort((a, b) => {
			if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		for (const node of nodes) {
			if (node.children) sortNodes(node.children);
		}
	};
	sortNodes(root);
	return root;
}

const IGNORED_DIRS = [
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"__pycache__",
	".obsidian",
	".trash",
	".venv",
	"vendor",
	"target",
	".cache",
	"coverage",
	".turbo",
	".svelte-kit",
	".nuxt",
	".output",
	".parcel-cache",
	".webpack",
	".expo",
];

/** Recursively walk a directory collecting markdown files, skipping ignored dirs. */
function walkMarkdownFiles(dir: string, root: string, results: string[]): void {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (IGNORED_DIRS.includes(entry.name)) continue;
			walkMarkdownFiles(join(dir, entry.name), root, results);
		} else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
			const relative = join(dir, entry.name)
				.slice(root.length + 1)
				.replace(/\\/g, "/");
			results.push(relative);
		}
	}
}

/** Serve a linked markdown document. Node.js equivalent of handleDoc. */
export function handleDocRequest(res: Res, url: URL): void {
	const requestedPath = url.searchParams.get("path");
	if (!requestedPath) {
		json(res, { error: "Missing path parameter" }, 400);
		return;
	}

	// Try resolving relative to base directory first (used by annotate mode)
	const base = url.searchParams.get("base");
	if (
		base &&
		!requestedPath.startsWith("/") &&
		/\.mdx?$/i.test(requestedPath)
	) {
		const fromBase = resolvePath(base, requestedPath);
		try {
			if (existsSync(fromBase)) {
				const markdown = readFileSync(fromBase, "utf-8");
				json(res, { markdown, filepath: fromBase });
				return;
			}
		} catch {
			/* fall through */
		}
	}

	// Absolute path
	if (isAbsolute(requestedPath)) {
		if (/\.mdx?$/i.test(requestedPath) && existsSync(requestedPath)) {
			try {
				const markdown = readFileSync(requestedPath, "utf-8");
				json(res, { markdown, filepath: requestedPath });
				return;
			} catch {
				/* fall through */
			}
		}
		json(res, { error: `File not found: ${requestedPath}` }, 404);
		return;
	}

	// Relative to cwd
	const projectRoot = process.cwd();
	const fromRoot = resolvePath(projectRoot, requestedPath);
	if (/\.mdx?$/i.test(fromRoot) && existsSync(fromRoot)) {
		try {
			const markdown = readFileSync(fromRoot, "utf-8");
			json(res, { markdown, filepath: fromRoot });
			return;
		} catch {
			/* fall through */
		}
	}

	// Case-insensitive search for bare filenames
	if (!requestedPath.includes("/") && /\.mdx?$/i.test(requestedPath)) {
		const files: string[] = [];
		walkMarkdownFiles(projectRoot, projectRoot, files);
		const target = requestedPath.toLowerCase();
		const matches = files.filter(
			(f) => f.split("/").pop()!.toLowerCase() === target,
		);
		if (matches.length === 1) {
			const fullPath = resolvePath(projectRoot, matches[0]);
			try {
				const markdown = readFileSync(fullPath, "utf-8");
				json(res, { markdown, filepath: fullPath });
				return;
			} catch {
				/* fall through */
			}
		}
		if (matches.length > 1) {
			json(
				res,
				{
					error: `Ambiguous filename '${requestedPath}': found ${matches.length} matches`,
					matches,
				},
				400,
			);
			return;
		}
	}

	json(res, { error: `File not found: ${requestedPath}` }, 404);
}

/** Detect Obsidian vaults. Node.js copy of detectObsidianVaults from integrations.ts. */
function detectObsidianVaults(): string[] {
	try {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		let configPath: string;
		if (process.platform === "darwin") {
			configPath = join(
				home,
				"Library/Application Support/obsidian/obsidian.json",
			);
		} else if (process.platform === "win32") {
			const appData = process.env.APPDATA || join(home, "AppData/Roaming");
			configPath = join(appData, "obsidian/obsidian.json");
		} else {
			configPath = join(home, ".config/obsidian/obsidian.json");
		}
		if (!existsSync(configPath)) return [];
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		if (!config.vaults || typeof config.vaults !== "object") return [];
		const vaults: string[] = [];
		for (const vaultId of Object.keys(config.vaults)) {
			const vault = config.vaults[vaultId];
			if (vault.path && existsSync(vault.path)) vaults.push(vault.path);
		}
		return vaults;
	} catch {
		return [];
	}
}

export function handleObsidianVaultsRequest(res: Res): void {
	json(res, { vaults: detectObsidianVaults() });
}

export function handleObsidianFilesRequest(res: Res, url: URL): void {
	const vaultPath = url.searchParams.get("vaultPath");
	if (!vaultPath) {
		json(res, { error: "Missing vaultPath parameter" }, 400);
		return;
	}
	const resolvedVault = resolvePath(vaultPath);
	if (!existsSync(resolvedVault) || !statSync(resolvedVault).isDirectory()) {
		json(res, { error: "Invalid vault path" }, 400);
		return;
	}
	try {
		const files: string[] = [];
		walkMarkdownFiles(resolvedVault, resolvedVault, files);
		files.sort();
		json(res, { tree: buildFileTree(files) });
	} catch {
		json(res, { error: "Failed to list vault files" }, 500);
	}
}

export function handleObsidianDocRequest(res: Res, url: URL): void {
	const vaultPath = url.searchParams.get("vaultPath");
	const filePath = url.searchParams.get("path");
	if (!vaultPath || !filePath) {
		json(res, { error: "Missing vaultPath or path parameter" }, 400);
		return;
	}
	if (!/\.mdx?$/i.test(filePath)) {
		json(res, { error: "Only markdown files are supported" }, 400);
		return;
	}
	const resolvedVault = resolvePath(vaultPath);
	let resolvedFile = resolvePath(resolvedVault, filePath);

	// Bare filename search within vault
	if (!existsSync(resolvedFile) && !filePath.includes("/")) {
		const files: string[] = [];
		walkMarkdownFiles(resolvedVault, resolvedVault, files);
		const matches = files.filter(
			(f) => f.split("/").pop()!.toLowerCase() === filePath.toLowerCase(),
		);
		if (matches.length === 1) {
			resolvedFile = resolvePath(resolvedVault, matches[0]);
		} else if (matches.length > 1) {
			json(
				res,
				{
					error: `Ambiguous filename '${filePath}': found ${matches.length} matches`,
					matches,
				},
				400,
			);
			return;
		}
	}

	// Security: must be within vault
	if (
		!resolvedFile.startsWith(resolvedVault + "/") &&
		resolvedFile !== resolvedVault
	) {
		json(res, { error: "Access denied: path is outside vault" }, 403);
		return;
	}

	if (!existsSync(resolvedFile)) {
		json(res, { error: `File not found: ${filePath}` }, 404);
		return;
	}
	try {
		const markdown = readFileSync(resolvedFile, "utf-8");
		json(res, { markdown, filepath: resolvedFile });
	} catch {
		json(res, { error: "Failed to read file" }, 500);
	}
}

export function handleFileBrowserRequest(res: Res, url: URL): void {
	const dirPath = url.searchParams.get("dirPath");
	if (!dirPath) {
		json(res, { error: "Missing dirPath parameter" }, 400);
		return;
	}
	const resolvedDir = resolvePath(dirPath);
	if (!existsSync(resolvedDir) || !statSync(resolvedDir).isDirectory()) {
		json(res, { error: "Invalid directory path" }, 400);
		return;
	}
	try {
		const files: string[] = [];
		walkMarkdownFiles(resolvedDir, resolvedDir, files);
		files.sort();
		json(res, { tree: buildFileTree(files) });
	} catch {
		json(res, { error: "Failed to list directory files" }, 500);
	}
}
