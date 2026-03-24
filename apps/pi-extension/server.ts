/**
 * Node-compatible servers for Plannotator Pi extension.
 *
 * Pi loads extensions via jiti (Node.js), so we can't use Bun.serve().
 * These are lightweight node:http servers implementing just the routes
 * each UI needs — plan review, code review, and markdown annotation.
 */

import { createServer } from "node:http";
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { Readable } from "node:stream";

import { contentHash, deleteDraft } from "./draft.js";
import { parseBody, json, html, send, toWebRequest } from "./server/helpers.js";
import { handleImageRequest, handleUploadRequest, handleDraftRequest, handleFavicon } from "./server/handlers.js";
import { createEditorAnnotationHandler } from "./server/annotations.js";
import { handleDocRequest, handleObsidianVaultsRequest, handleObsidianFilesRequest, handleObsidianDocRequest, handleFileBrowserRequest } from "./server/reference.js";
import { type ObsidianConfig, type BearConfig, type OctarineConfig, type IntegrationResult, saveToObsidian, saveToBear, saveToOctarine } from "./server/integrations.js";
import { openEditorDiff } from "./server/ide.js";
import { listenOnPort } from "./server/network.js";
import { detectProjectName, getRepoInfo } from "./server/project.js";
import { parsePRUrl, checkPRAuth, getPRUser, fetchPR, fetchPRContext, fetchPRFileContent, submitPRReview } from "./server/pr.js";
import { type PRMetadata, type PRReviewFileComment, prRefFromMetadata, getDisplayRepo, getMRLabel, getMRNumberLabel } from "./pr-provider.js";
import {
	type DiffType,
	type GitCommandResult,
	type GitContext,
	type ReviewGitRuntime,
	getFileContentsForDiff as getFileContentsForDiffCore,
	getGitContext as getGitContextCore,
	gitAddFile as gitAddFileCore,
	gitResetFile as gitResetFileCore,
	parseWorktreeDiffType,
	runGitDiff as runGitDiffCore,
	validateFilePath,
} from "./review-core.js";
import {
	generateSlug,
	saveToHistory,
	getPlanVersion,
	getPlanVersionPath,
	getVersionCount,
	listVersions,
	listArchivedPlans,
	readArchivedPlan,
	saveAnnotations,
	saveFinalSnapshot,
	type ArchivedPlan,
} from "./storage.js";

// ── Plan Review Server ──────────────────────────────────────────────────

export interface PlanServerResult {
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	waitForDecision: () => Promise<{ approved: boolean; feedback?: string }>;
	waitForDone?: () => Promise<void>;
	stop: () => void;
}

export async function startPlanReviewServer(options: {
	plan: string;
	htmlContent: string;
	origin?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	mode?: "archive";
	customPlanPath?: string | null;
}): Promise<PlanServerResult> {
	const sharingEnabled =
		options.sharingEnabled ?? process.env.PLANNOTATOR_SHARE !== "disabled";
	const shareBaseUrl =
		(options.shareBaseUrl ?? process.env.PLANNOTATOR_SHARE_URL) || undefined;
	const pasteApiUrl =
		(options.pasteApiUrl ?? process.env.PLANNOTATOR_PASTE_URL) || undefined;

	// --- Archive mode setup ---
	let archivePlans: ArchivedPlan[] = [];
	let initialArchivePlan = "";
	let resolveDone: (() => void) | undefined;
	let donePromise: Promise<void> | undefined;

	if (options.mode === "archive") {
		archivePlans = listArchivedPlans(options.customPlanPath ?? undefined);
		initialArchivePlan =
			archivePlans.length > 0
				? (readArchivedPlan(
						archivePlans[0].filename,
						options.customPlanPath ?? undefined,
					) ?? "")
				: "";
		donePromise = new Promise<void>((resolve) => {
			resolveDone = resolve;
		});
	}

	// --- Plan review mode setup (skip in archive mode) ---
	const slug = options.mode !== "archive" ? generateSlug(options.plan) : "";
	const project = options.mode !== "archive" ? detectProjectName() : "";
	const historyResult =
		options.mode !== "archive"
			? saveToHistory(project, slug, options.plan)
			: { version: 0, path: "", isNew: false };
	const previousPlan =
		options.mode !== "archive" && historyResult.version > 1
			? getPlanVersion(project, slug, historyResult.version - 1)
			: null;
	const versionInfo =
		options.mode !== "archive"
			? {
					version: historyResult.version,
					totalVersions: getVersionCount(project, slug),
					project,
				}
			: null;

	let resolveDecision!: (result: {
		approved: boolean;
		feedback?: string;
		agentSwitch?: string;
		permissionMode?: string;
	}) => void;
	const decisionPromise = new Promise<{
		approved: boolean;
		feedback?: string;
		agentSwitch?: string;
		permissionMode?: string;
	}>((r) => {
		resolveDecision = r;
	});

	// Draft key for annotation persistence
	const draftKey = options.mode !== "archive" ? contentHash(options.plan) : "";

	// Editor annotations (in-memory, VS Code integration)
	const editorAnnotations = createEditorAnnotationHandler();

	// Lazy cache for in-session archive tab
	let cachedArchivePlans: ArchivedPlan[] | null = null;

	const server = createServer(async (req, res) => {
		const url = new URL(req.url!, `http://localhost`);

		if (url.pathname === "/api/done" && req.method === "POST") {
			resolveDone?.();
			json(res, { ok: true });
		} else if (url.pathname === "/api/archive/plans") {
			const customPath = url.searchParams.get("customPath") || undefined;
			if (!cachedArchivePlans)
				cachedArchivePlans = listArchivedPlans(customPath);
			json(res, { plans: cachedArchivePlans });
		} else if (url.pathname === "/api/archive/plan") {
			const filename = url.searchParams.get("filename");
			const customPath = url.searchParams.get("customPath") || undefined;
			if (!filename) {
				json(res, { error: "Missing filename" }, 400);
				return;
			}
			const markdown = readArchivedPlan(filename, customPath);
			if (!markdown) {
				json(res, { error: "Not found" }, 404);
				return;
			}
			json(res, { markdown, filepath: filename });
		} else if (url.pathname === "/api/plan/version") {
			const vParam = url.searchParams.get("v");
			if (!vParam) {
				json(res, { error: "Missing v parameter" }, 400);
				return;
			}
			const v = parseInt(vParam, 10);
			if (isNaN(v) || v < 1) {
				json(res, { error: "Invalid version number" }, 400);
				return;
			}
			const content = getPlanVersion(project, slug, v);
			if (content === null) {
				json(res, { error: "Version not found" }, 404);
				return;
			}
			json(res, { plan: content, version: v });
		} else if (url.pathname === "/api/plan/versions") {
			json(res, { project, slug, versions: listVersions(project, slug) });
		} else if (url.pathname === "/api/plan") {
			if (options.mode === "archive") {
				json(res, {
					plan: initialArchivePlan,
					origin: options.origin ?? "pi",
					mode: "archive",
					archivePlans,
					sharingEnabled,
					shareBaseUrl,
					pasteApiUrl,
				});
			} else {
				json(res, {
					plan: options.plan,
					origin: options.origin ?? "pi",
					previousPlan,
					versionInfo,
					sharingEnabled,
					shareBaseUrl,
					pasteApiUrl,
					repoInfo: getRepoInfo(),
					projectRoot: process.cwd(),
				});
			}
		} else if (url.pathname === "/api/image") {
			handleImageRequest(res, url);
		} else if (url.pathname === "/api/upload" && req.method === "POST") {
			await handleUploadRequest(req, res);
		} else if (url.pathname === "/api/draft") {
			await handleDraftRequest(req, res, draftKey);
		} else if (await editorAnnotations.handle(req, res, url)) {
			return;
		} else if (url.pathname === "/api/doc") {
			handleDocRequest(res, url);
		} else if (url.pathname === "/api/obsidian/vaults") {
			handleObsidianVaultsRequest(res);
		} else if (url.pathname === "/api/reference/obsidian/files") {
			handleObsidianFilesRequest(res, url);
		} else if (url.pathname === "/api/reference/obsidian/doc") {
			handleObsidianDocRequest(res, url);
		} else if (url.pathname === "/api/reference/files") {
			handleFileBrowserRequest(res, url);
		} else if (
			url.pathname === "/api/plan/vscode-diff" &&
			req.method === "POST"
		) {
			try {
				const body = await parseBody(req);
				const baseVersion = body.baseVersion as number;
				if (!baseVersion) {
					json(res, { error: "Missing baseVersion" }, 400);
					return;
				}
				const basePath = getPlanVersionPath(project, slug, baseVersion);
				if (!basePath) {
					json(res, { error: `Version ${baseVersion} not found` }, 404);
					return;
				}
				const result = await openEditorDiff(basePath, historyResult.path);
				if ("error" in result) {
					json(res, { error: result.error }, 500);
					return;
				}
				json(res, { ok: true });
			} catch (err) {
				json(
					res,
					{
						error:
							err instanceof Error
								? err.message
								: "Failed to open VS Code diff",
					},
					500,
				);
			}
		} else if (url.pathname === "/api/agents" && req.method === "GET") {
			json(res, { agents: [] });
		} else if (url.pathname === "/favicon.svg") {
			handleFavicon(res);
		} else if (url.pathname === "/api/save-notes" && req.method === "POST") {
			const results: {
				obsidian?: IntegrationResult;
				bear?: IntegrationResult;
				octarine?: IntegrationResult;
			} = {};
			try {
				const body = await parseBody(req);
				const promises: Promise<void>[] = [];
				const obsConfig = body.obsidian as ObsidianConfig | undefined;
				const bearConfig = body.bear as BearConfig | undefined;
				const octConfig = body.octarine as OctarineConfig | undefined;
				if (obsConfig?.vaultPath && obsConfig?.plan) {
					promises.push(
						saveToObsidian(obsConfig).then((r) => {
							results.obsidian = r;
						}),
					);
				}
				if (bearConfig?.plan) {
					promises.push(
						saveToBear(bearConfig).then((r) => {
							results.bear = r;
						}),
					);
				}
				if (octConfig?.plan && octConfig?.workspace) {
					promises.push(
						saveToOctarine(octConfig).then((r) => {
							results.octarine = r;
						}),
					);
				}
				await Promise.allSettled(promises);
				for (const [name, result] of Object.entries(results)) {
					if (!result?.success && result)
						console.error(`[${name}] Save failed: ${result.error}`);
				}
			} catch (err) {
				console.error(`[Save Notes] Error:`, err);
				json(res, { error: "Save failed" }, 500);
				return;
			}
			json(res, { ok: true, results });
		} else if (url.pathname === "/api/approve" && req.method === "POST") {
			let feedback: string | undefined;
			let agentSwitch: string | undefined;
			let requestedPermissionMode: string | undefined;
			let planSaveEnabled = true;
			let planSaveCustomPath: string | undefined;
			try {
				const body = await parseBody(req);
				if (body.feedback) feedback = body.feedback as string;
				if (body.agentSwitch) agentSwitch = body.agentSwitch as string;
				if (body.permissionMode)
					requestedPermissionMode = body.permissionMode as string;
				if (body.planSave !== undefined) {
					const ps = body.planSave as { enabled: boolean; customPath?: string };
					planSaveEnabled = ps.enabled;
					planSaveCustomPath = ps.customPath;
				}
				// Run note integrations in parallel
				const integrationResults: Record<string, IntegrationResult> = {};
				const integrationPromises: Promise<void>[] = [];
				const obsConfig = body.obsidian as ObsidianConfig | undefined;
				const bearConfig = body.bear as BearConfig | undefined;
				const octConfig = body.octarine as OctarineConfig | undefined;
				if (obsConfig?.vaultPath && obsConfig?.plan) {
					integrationPromises.push(
						saveToObsidian(obsConfig).then((r) => {
							integrationResults.obsidian = r;
						}),
					);
				}
				if (bearConfig?.plan) {
					integrationPromises.push(
						saveToBear(bearConfig).then((r) => {
							integrationResults.bear = r;
						}),
					);
				}
				if (octConfig?.plan && octConfig?.workspace) {
					integrationPromises.push(
						saveToOctarine(octConfig).then((r) => {
							integrationResults.octarine = r;
						}),
					);
				}
				await Promise.allSettled(integrationPromises);
				for (const [name, result] of Object.entries(integrationResults)) {
					if (!result?.success && result)
						console.error(`[${name}] Save failed: ${result.error}`);
				}
			} catch (err) {
				console.error(`[Integration] Error:`, err);
			}
			// Save annotations and final snapshot
			let savedPath: string | undefined;
			if (planSaveEnabled) {
				const annotations = feedback || "";
				if (annotations) saveAnnotations(slug, annotations, planSaveCustomPath);
				savedPath = saveFinalSnapshot(
					slug,
					"approved",
					options.plan,
					annotations,
					planSaveCustomPath,
				);
			}
			deleteDraft(draftKey);
			resolveDecision({
				approved: true,
				feedback,
				agentSwitch,
				permissionMode: requestedPermissionMode,
			});
			json(res, { ok: true, savedPath });
		} else if (url.pathname === "/api/deny" && req.method === "POST") {
			let feedback = "Plan rejected by user";
			let planSaveEnabled = true;
			let planSaveCustomPath: string | undefined;
			try {
				const body = await parseBody(req);
				feedback = (body.feedback as string) || feedback;
				if (body.planSave !== undefined) {
					const ps = body.planSave as { enabled: boolean; customPath?: string };
					planSaveEnabled = ps.enabled;
					planSaveCustomPath = ps.customPath;
				}
			} catch {
				/* use default feedback */
			}
			let savedPath: string | undefined;
			if (planSaveEnabled) {
				saveAnnotations(slug, feedback, planSaveCustomPath);
				savedPath = saveFinalSnapshot(
					slug,
					"denied",
					options.plan,
					feedback,
					planSaveCustomPath,
				);
			}
			deleteDraft(draftKey);
			resolveDecision({ approved: false, feedback });
			json(res, { ok: true, savedPath });
		} else {
			html(res, options.htmlContent);
		}
	});

	const { port, portSource } = await listenOnPort(server);

	return {
		port,
		portSource,
		url: `http://localhost:${port}`,
		waitForDecision: () => decisionPromise,
		...(donePromise && { waitForDone: () => donePromise }),
		stop: () => server.close(),
	};
}

export type { DiffType, DiffOption, GitContext } from "./review-core.js";

export interface ReviewServerResult {
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	waitForDecision: () => Promise<{
		approved: boolean;
		feedback: string;
		annotations: unknown[];
		agentSwitch?: string;
	}>;
	stop: () => void;
}

/** Run a git command and return stdout (empty string on error). */
function git(cmd: string): string {
	try {
		return execSync(`git ${cmd}`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return "";
	}
}

const reviewRuntime: ReviewGitRuntime = {
	async runGit(
		args: string[],
		options?: { cwd?: string },
	): Promise<GitCommandResult> {
		const result = spawnSync("git", args, {
			cwd: options?.cwd,
			encoding: "utf-8",
		});
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			exitCode: result.status ?? (result.error ? 1 : 0),
		};
	},

	async readTextFile(path: string): Promise<string | null> {
		try {
			return readFileSync(path, "utf-8");
		} catch {
			return null;
		}
	},
};

export function getGitContext(): Promise<GitContext> {
	return getGitContextCore(reviewRuntime);
}

export function runGitDiff(
	diffType: DiffType,
	defaultBranch = "main",
	cwd?: string,
): Promise<{ patch: string; label: string; error?: string }> {
	return runGitDiffCore(reviewRuntime, diffType, defaultBranch, cwd);
}

export async function startReviewServer(options: {
	rawPatch: string;
	gitRef: string;
	htmlContent: string;
	origin?: string;
	diffType?: DiffType;
	gitContext?: GitContext;
	error?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	prMetadata?: PRMetadata;
}): Promise<ReviewServerResult> {
	const draftKey = contentHash(options.rawPatch);
	const isPRMode = !!options.prMetadata;
	const prRef = isPRMode ? prRefFromMetadata(options.prMetadata!) : null;
	const platformUser = prRef ? await getPRUser(prRef) : null;
	const repoInfo = isPRMode
		? {
				display: getDisplayRepo(options.prMetadata!),
				branch: `${getMRLabel(options.prMetadata!)} ${getMRNumberLabel(options.prMetadata!)}`,
			}
		: getRepoInfo();
	const editorAnnotations = createEditorAnnotationHandler();
	let currentPatch = options.rawPatch;
	let currentGitRef = options.gitRef;
	let currentDiffType: DiffType = options.diffType || "uncommitted";
	let currentError = options.error;
	const sharingEnabled =
		options.sharingEnabled ?? process.env.PLANNOTATOR_SHARE !== "disabled";
	const shareBaseUrl =
		(options.shareBaseUrl ?? process.env.PLANNOTATOR_SHARE_URL) || undefined;
	const pasteApiUrl =
		(options.pasteApiUrl ?? process.env.PLANNOTATOR_PASTE_URL) || undefined;

	let resolveDecision!: (result: {
		approved: boolean;
		feedback: string;
		annotations: unknown[];
		agentSwitch?: string;
	}) => void;
	const decisionPromise = new Promise<{
		approved: boolean;
		feedback: string;
		annotations: unknown[];
		agentSwitch?: string;
	}>((r) => {
		resolveDecision = r;
	});

	// AI provider setup (graceful — AI features degrade if SDK unavailable)
	// Types are `any` because @plannotator/ai is a dynamic import
	let aiEndpoints: Record<string, (req: Request) => Promise<Response>> | null =
		null;
	let aiSessionManager: { disposeAll: () => void } | null = null;
	let aiRegistry: { disposeAll: () => void } | null = null;
	try {
		const ai = await import("@plannotator/ai");
		const registry = new ai.ProviderRegistry();
		const sessionManager = new ai.SessionManager();

		// which() helper for Node.js
		const whichCmd = (cmd: string): string | null => {
			try {
				return (
					execSync(`which ${cmd}`, {
						encoding: "utf-8",
						stdio: ["pipe", "pipe", "pipe"],
					}).trim() || null
				);
			} catch {
				return null;
			}
		};

		// Claude Agent SDK
		try {
			await import("@plannotator/ai/providers/claude-agent-sdk");
			const claudePath = whichCmd("claude");
			const provider = await ai.createProvider({
				type: "claude-agent-sdk",
				cwd: process.cwd(),
				...(claudePath && { claudeExecutablePath: claudePath }),
			});
			registry.register(provider);
		} catch {
			/* Claude SDK not available */
		}

		// Codex SDK
		try {
			await import("@plannotator/ai/providers/codex-sdk");
			await import("@openai/codex-sdk");
			const codexPath = whichCmd("codex");
			const provider = await ai.createProvider({
				type: "codex-sdk",
				cwd: process.cwd(),
				...(codexPath && { codexExecutablePath: codexPath }),
			});
			registry.register(provider);
		} catch {
			/* Codex SDK not available */
		}

		// Pi SDK (Node.js variant)
		try {
			await import("@plannotator/ai/providers/pi-sdk-node");
			const piPath = whichCmd("pi");
			if (piPath) {
				const provider = await ai.createProvider({
					type: "pi-sdk",
					cwd: process.cwd(),
					piExecutablePath: piPath,
				} as any);
				if (provider && "fetchModels" in provider) {
					await (
						provider as { fetchModels: () => Promise<void> }
					).fetchModels();
				}
				registry.register(provider);
			}
		} catch {
			/* Pi not available */
		}

		// OpenCode SDK
		try {
			await import("@plannotator/ai/providers/opencode-sdk");
			const opencodePath = whichCmd("opencode");
			if (opencodePath) {
				const provider = await ai.createProvider({
					type: "opencode-sdk",
					cwd: process.cwd(),
				});
				if (provider && "fetchModels" in provider) {
					await (
						provider as { fetchModels: () => Promise<void> }
					).fetchModels();
				}
				registry.register(provider);
			}
		} catch {
			/* OpenCode not available */
		}

		if (registry.size > 0) {
			aiEndpoints = ai.createAIEndpoints({
				registry,
				sessionManager,
				getCwd: () => options.gitContext?.cwd ?? process.cwd(),
			});
			aiSessionManager = sessionManager;
			aiRegistry = registry;
		}
	} catch {
		/* AI backbone not available */
	}

	const server = createServer(async (req, res) => {
		const url = new URL(req.url!, `http://localhost`);

		if (url.pathname === "/api/diff" && req.method === "GET") {
			json(res, {
				rawPatch: currentPatch,
				gitRef: currentGitRef,
				origin: options.origin ?? "pi",
				diffType: isPRMode ? undefined : currentDiffType,
				gitContext: isPRMode ? undefined : options.gitContext,
				sharingEnabled,
				shareBaseUrl,
				pasteApiUrl,
				repoInfo,
				...(isPRMode && { prMetadata: options.prMetadata, platformUser }),
				...(currentError ? { error: currentError } : {}),
			});
		} else if (url.pathname === "/api/diff/switch" && req.method === "POST") {
			if (isPRMode) {
				json(res, { error: "Not available for PR reviews" }, 400);
				return;
			}
			const body = await parseBody(req);
			const newType = body.diffType as DiffType;
			if (!newType) {
				json(res, { error: "Missing diffType" }, 400);
				return;
			}
			const defaultBranch = options.gitContext?.defaultBranch || "main";
			const defaultCwd = options.gitContext?.cwd;
			const result = await runGitDiff(newType, defaultBranch, defaultCwd);
			currentPatch = result.patch;
			currentGitRef = result.label;
			currentDiffType = newType;
			currentError = result.error;
			json(res, {
				rawPatch: currentPatch,
				gitRef: currentGitRef,
				diffType: currentDiffType,
				...(currentError ? { error: currentError } : {}),
			});
		} else if (url.pathname === "/api/pr-context" && req.method === "GET") {
			if (!isPRMode || !prRef) {
				json(res, { error: "Not in PR mode" }, 400);
				return;
			}
			try {
				const context = await fetchPRContext(prRef);
				json(res, context);
			} catch (err) {
				json(
					res,
					{
						error:
							err instanceof Error ? err.message : "Failed to fetch PR context",
					},
					500,
				);
			}
		} else if (url.pathname === "/api/pr-action" && req.method === "POST") {
			if (!isPRMode || !options.prMetadata || !prRef) {
				json(res, { error: "Not in PR mode" }, 400);
				return;
			}
			try {
				const body = await parseBody(req);
				await submitPRReview(
					prRef,
					options.prMetadata.headSha,
					body.action as "approve" | "comment",
					body.body as string,
					(body.fileComments as PRReviewFileComment[]) || [],
				);
				json(res, { ok: true, prUrl: options.prMetadata.url });
			} catch (err) {
				json(
					res,
					{
						error:
							err instanceof Error ? err.message : "Failed to submit PR review",
					},
					500,
				);
			}
		} else if (url.pathname === "/api/file-content" && req.method === "GET") {
			const filePath = url.searchParams.get("path");
			if (!filePath) {
				json(res, { error: "Missing path" }, 400);
				return;
			}
			try {
				validateFilePath(filePath);
			} catch {
				json(res, { error: "Invalid path" }, 400);
				return;
			}
			const oldPath = url.searchParams.get("oldPath") || undefined;
			if (oldPath) {
				try {
					validateFilePath(oldPath);
				} catch {
					json(res, { error: "Invalid path" }, 400);
					return;
				}
			}

			if (isPRMode && prRef && options.prMetadata) {
				try {
					const [oldContent, newContent] = await Promise.all([
						fetchPRFileContent(
							prRef,
							options.prMetadata.baseSha,
							oldPath || filePath,
						),
						fetchPRFileContent(prRef, options.prMetadata.headSha, filePath),
					]);
					json(res, { oldContent, newContent });
				} catch (err) {
					json(
						res,
						{
							error:
								err instanceof Error
									? err.message
									: "Failed to fetch file content",
						},
						500,
					);
				}
				return;
			}

			const defaultBranch = options.gitContext?.defaultBranch || "main";
			const defaultCwd = options.gitContext?.cwd;
			const result = await getFileContentsForDiffCore(
				reviewRuntime,
				currentDiffType,
				defaultBranch,
				filePath,
				oldPath,
				defaultCwd,
			);
			json(res, result);
		} else if (url.pathname === "/api/image") {
			handleImageRequest(res, url);
		} else if (url.pathname === "/api/upload" && req.method === "POST") {
			await handleUploadRequest(req, res);
		} else if (url.pathname === "/api/agents" && req.method === "GET") {
			json(res, { agents: [] });
		} else if (url.pathname === "/api/git-add" && req.method === "POST") {
			if (isPRMode) {
				json(res, { error: "Not available for PR reviews" }, 400);
				return;
			}
			const body = await parseBody(req);
			const filePath = body.filePath as string | undefined;
			if (!filePath) {
				json(res, { error: "Missing filePath" }, 400);
				return;
			}
			try {
				let cwd: string | undefined;
				if (currentDiffType.startsWith("worktree:")) {
					const parsed = parseWorktreeDiffType(currentDiffType);
					if (parsed) cwd = parsed.path;
				}
				if (!cwd) {
					cwd = options.gitContext?.cwd;
				}
				if (body.undo) {
					await gitResetFileCore(reviewRuntime, filePath, cwd);
				} else {
					await gitAddFileCore(reviewRuntime, filePath, cwd);
				}
				json(res, { ok: true });
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Failed to git add";
				json(res, { error: message }, 500);
			}
		} else if (url.pathname === "/api/draft") {
			await handleDraftRequest(req, res, draftKey);
		} else if (url.pathname === "/favicon.svg") {
			handleFavicon(res);
		} else if (await editorAnnotations.handle(req, res, url)) {
			return;
		} else if (aiEndpoints && url.pathname.startsWith("/api/ai/")) {
			const handler = aiEndpoints[url.pathname];
			if (handler) {
				try {
					const webReq = toWebRequest(req);
					const webRes = await handler(webReq);
					// Pipe Web Response → node:http response
					const headers: Record<string, string> = {};
					webRes.headers.forEach((v, k) => { headers[k] = v; });
					res.writeHead(webRes.status, headers);
					if (webRes.body) {
						const nodeStream = Readable.fromWeb(
							webRes.body as any,
						);
						nodeStream.pipe(res);
					} else {
						res.end();
					}
				} catch (err) {
					json(
						res,
						{ error: err instanceof Error ? err.message : "AI endpoint error" },
						500,
					);
				}
				return;
			}
			json(res, { error: "Not found" }, 404);
		} else if (url.pathname === "/api/feedback" && req.method === "POST") {
			const body = await parseBody(req);
			deleteDraft(draftKey);
			resolveDecision({
				approved: (body.approved as boolean) ?? false,
				feedback: (body.feedback as string) || "",
				annotations: (body.annotations as unknown[]) || [],
				agentSwitch: body.agentSwitch as string | undefined,
			});
			json(res, { ok: true });
		} else {
			html(res, options.htmlContent);
		}
	});

	const { port, portSource } = await listenOnPort(server);

	return {
		port,
		portSource,
		url: `http://localhost:${port}`,
		waitForDecision: () => decisionPromise,
		stop: () => {
			aiSessionManager?.disposeAll();
			aiRegistry?.disposeAll();
			server.close();
		},
	};
}

// ── Annotate Server ─────────────────────────────────────────────────────

export interface AnnotateServerResult {
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	waitForDecision: () => Promise<{ feedback: string; annotations: unknown[] }>;
	stop: () => void;
}

export async function startAnnotateServer(options: {
	markdown: string;
	filePath: string;
	htmlContent: string;
	origin?: string;
	mode?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
}): Promise<AnnotateServerResult> {
	const sharingEnabled =
		options.sharingEnabled ?? process.env.PLANNOTATOR_SHARE !== "disabled";
	const shareBaseUrl =
		(options.shareBaseUrl ?? process.env.PLANNOTATOR_SHARE_URL) || undefined;
	const pasteApiUrl =
		(options.pasteApiUrl ?? process.env.PLANNOTATOR_PASTE_URL) || undefined;

	let resolveDecision!: (result: {
		feedback: string;
		annotations: unknown[];
	}) => void;
	const decisionPromise = new Promise<{
		feedback: string;
		annotations: unknown[];
	}>((r) => {
		resolveDecision = r;
	});

	// Draft key for annotation persistence
	const draftKey = contentHash(options.markdown);

	const server = createServer(async (req, res) => {
		const url = new URL(req.url!, `http://localhost`);

		if (url.pathname === "/api/plan" && req.method === "GET") {
			json(res, {
				plan: options.markdown,
				origin: options.origin ?? "pi",
				mode: options.mode || "annotate",
				filePath: options.filePath,
				sharingEnabled,
				shareBaseUrl,
				pasteApiUrl,
				repoInfo: getRepoInfo(),
				projectRoot: process.cwd(),
			});
		} else if (url.pathname === "/api/image") {
			handleImageRequest(res, url);
		} else if (url.pathname === "/api/upload" && req.method === "POST") {
			await handleUploadRequest(req, res);
		} else if (url.pathname === "/api/draft") {
			await handleDraftRequest(req, res, draftKey);
		} else if (url.pathname === "/api/doc") {
			// Inject source file's directory as base for relative path resolution
			if (!url.searchParams.has("base") && options.filePath) {
				url.searchParams.set("base", dirname(resolvePath(options.filePath)));
			}
			handleDocRequest(res, url);
		} else if (url.pathname === "/api/reference/files") {
			handleFileBrowserRequest(res, url);
		} else if (url.pathname === "/favicon.svg") {
			handleFavicon(res);
		} else if (url.pathname === "/api/feedback" && req.method === "POST") {
			const body = await parseBody(req);
			deleteDraft(draftKey);
			resolveDecision({
				feedback: (body.feedback as string) || "",
				annotations: (body.annotations as unknown[]) || [],
			});
			json(res, { ok: true });
		} else {
			html(res, options.htmlContent);
		}
	});

	const { port, portSource } = await listenOnPort(server);

	return {
		port,
		portSource,
		url: `http://localhost:${port}`,
		waitForDecision: () => decisionPromise,
		stop: () => server.close(),
	};
}
