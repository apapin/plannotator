import { describe, expect, test } from "bun:test";
import {
	getToolsForPhase,
	isPlanWritePathAllowed,
	PLAN_SUBMIT_TOOL,
	stripPlanningOnlyTools,
} from "./tool-scope";

describe("pi plan tool scoping", () => {
	test("planning phase adds the submit tool and discovery helpers", () => {
		expect(getToolsForPhase(["read", "bash", "edit", "write"], "planning")).toEqual([
			"read",
			"bash",
			"edit",
			"write",
			"grep",
			"find",
			"ls",
			PLAN_SUBMIT_TOOL,
		]);
	});

	test("idle and executing phases strip the planning-only submit tool", () => {
		const leakedTools = ["read", "bash", "grep", PLAN_SUBMIT_TOOL, "write"];

		expect(getToolsForPhase(leakedTools, "idle")).toEqual([
			"read",
			"bash",
			"grep",
			"write",
		]);
		expect(getToolsForPhase(leakedTools, "executing")).toEqual([
			"read",
			"bash",
			"grep",
			"write",
		]);
	});

	test("stripping planning-only tools preserves unrelated tools", () => {
		expect(stripPlanningOnlyTools([PLAN_SUBMIT_TOOL, "todo", "question", "read"])).toEqual([
			"todo",
			"question",
			"read",
		]);
	});
});

describe("plan write path gate", () => {
	const cwd = "/r";

	test("default PLAN.md allows exact file and blocks everything else", () => {
		expect(isPlanWritePathAllowed("PLAN.md", "PLAN.md", cwd)).toBe(true);
		expect(isPlanWritePathAllowed("PLAN.md", "src/app.ts", cwd)).toBe(false);
	});

	test("trailing-slash directory scopes to files inside", () => {
		expect(isPlanWritePathAllowed("plans/", "plans/foo.md", cwd)).toBe(true);
		expect(isPlanWritePathAllowed("plans/", "src/app.ts", cwd)).toBe(false);
	});

	test("bare directory name (no slash, no extension) scopes to files inside", () => {
		expect(isPlanWritePathAllowed("plans", "plans/foo.md", cwd)).toBe(true);
		expect(isPlanWritePathAllowed("plans", "src/app.ts", cwd)).toBe(false);
	});

	test("file inside a subdir allows siblings and blocks outside", () => {
		expect(isPlanWritePathAllowed("plans/foo.md", "plans/bar.md", cwd)).toBe(true);
		expect(isPlanWritePathAllowed("plans/foo.md", "src/app.ts", cwd)).toBe(false);
	});

	test("path traversal is rejected", () => {
		expect(isPlanWritePathAllowed("plans/", "../../etc/passwd", cwd)).toBe(false);
	});

	test("absolute input paths resolve the same as relative", () => {
		expect(isPlanWritePathAllowed("plans/", "/r/plans/foo.md", cwd)).toBe(true);
	});
});
