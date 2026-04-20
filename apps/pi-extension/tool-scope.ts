import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type Phase = "idle" | "planning" | "executing";

export const PLAN_SUBMIT_TOOL = "plannotator_submit_plan";
export const PLANNING_DISCOVERY_TOOLS = ["grep", "find", "ls"] as const;

const PLANNING_ONLY_TOOLS = new Set<string>([PLAN_SUBMIT_TOOL]);

export function stripPlanningOnlyTools(tools: readonly string[]): string[] {
	return tools.filter((tool) => !PLANNING_ONLY_TOOLS.has(tool));
}

export function getToolsForPhase(
	baseTools: readonly string[],
	phase: Phase,
): string[] {
	const tools = stripPlanningOnlyTools(baseTools);
	if (phase !== "planning") {
		return [...new Set(tools)];
	}

	return [
		...new Set([...tools, ...PLANNING_DISCOVERY_TOOLS, PLAN_SUBMIT_TOOL]),
	];
}

// Treat planFilePath as directory-scoped when it ends with a separator or its
// basename has no extension (e.g. "plans/", "plans"). Otherwise scope is the
// single file.
function isPlanPathDirectoryScoped(planFilePath: string): boolean {
	if (planFilePath.endsWith("/") || planFilePath.endsWith(sep)) return true;
	const base = basename(planFilePath);
	return base.length > 0 && !base.includes(".");
}

export function isPlanWritePathAllowed(
	planFilePath: string,
	inputPath: string,
	cwd: string,
): boolean {
	const targetAbs = resolve(cwd, inputPath);
	const allowedAbs = resolve(cwd, planFilePath);
	if (targetAbs === allowedAbs) return true;

	const dirScoped = isPlanPathDirectoryScoped(planFilePath);
	const scopeDir = dirScoped ? allowedAbs : dirname(allowedAbs);

	// Never scope to cwd root — a default like "PLAN.md" would otherwise unlock
	// every file in the project.
	if (resolve(scopeDir) === resolve(cwd)) return false;

	const rel = relative(scopeDir, targetAbs);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
