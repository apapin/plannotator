import { describe, test, expect } from "bun:test";
import { SessionManager } from "./session-manager.ts";
import { buildSystemPrompt, buildForkPreamble } from "./context.ts";
import {
  ProviderRegistry,
  registerProviderFactory,
  createProvider,
} from "./provider.ts";
import { createAIEndpoints } from "./endpoints.ts";
import type {
  AIProvider,
  AISession,
  AIMessage,
  AIContext,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers — mock provider/session for testing
// ---------------------------------------------------------------------------

function mockSession(
  id: string,
  parentSessionId: string | null = null
): AISession {
  let active = false;
  return {
    get id() {
      return id;
    },
    parentSessionId,
    get isActive() {
      return active;
    },
    async *query(prompt: string): AsyncIterable<AIMessage> {
      active = true;
      yield { type: "text_delta", delta: `Echo: ${prompt}` };
      yield {
        type: "result",
        sessionId: id,
        success: true,
        result: `Echo: ${prompt}`,
      };
      active = false;
    },
    abort() {
      active = false;
    },
  };
}

let sessionCounter = 0;

function mockProvider(name = "mock"): AIProvider {
  return {
    name,
    capabilities: { fork: true, resume: true, streaming: true, tools: false },
    async createSession(opts) {
      return mockSession(`session-${++sessionCounter}`, null);
    },
    async forkSession(opts) {
      const parent = opts.context.parent;
      return mockSession(
        `forked-${++sessionCounter}`,
        parent?.sessionId ?? null
      );
    },
    async resumeSession(sessionId) {
      return mockSession(sessionId, null);
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

describe("SessionManager", () => {
  test("tracks sessions and lists them newest-first", () => {
    const sm = new SessionManager();
    const s1 = mockSession("s1");
    const s2 = mockSession("s2");

    const e1 = sm.track(s1, "plan-review", "First");
    const e2 = sm.track(s2, "code-review", "Second");
    e1.lastActiveAt = 1000;
    e2.lastActiveAt = 2000;

    expect(sm.size).toBe(2);
    const list = sm.list();
    expect(list[0].session.id).toBe("s2");
    expect(list[1].session.id).toBe("s1");
  });

  test("get returns entry by ID", () => {
    const sm = new SessionManager();
    sm.track(mockSession("s1"), "plan-review");
    expect(sm.get("s1")?.session.id).toBe("s1");
    expect(sm.get("nonexistent")).toBeUndefined();
  });

  test("touch updates lastActiveAt", async () => {
    const sm = new SessionManager();
    sm.track(mockSession("s1"), "plan-review");
    const before = sm.get("s1")!.lastActiveAt;

    await new Promise((r) => setTimeout(r, 10));
    sm.touch("s1");

    expect(sm.get("s1")!.lastActiveAt).toBeGreaterThan(before);
  });

  test("remove removes entry", () => {
    const sm = new SessionManager();
    sm.track(mockSession("s1"), "plan-review");
    sm.remove("s1");
    expect(sm.size).toBe(0);
  });

  test("forksOf filters by parent", () => {
    const sm = new SessionManager();
    sm.track(mockSession("s1"), "plan-review");
    sm.track(mockSession("fork1", "parent-123"), "plan-review");
    sm.track(mockSession("fork2", "parent-123"), "plan-review");
    sm.track(mockSession("fork3", "other-parent"), "code-review");

    const forks = sm.forksOf("parent-123");
    expect(forks.length).toBe(2);
    expect(forks.map((f) => f.session.id).sort()).toEqual(["fork1", "fork2"]);
  });

  test("evicts oldest idle session when maxSessions reached", () => {
    const sm = new SessionManager({ maxSessions: 2 });
    sm.track(mockSession("s1"), "plan-review");
    sm.track(mockSession("s2"), "plan-review");
    sm.track(mockSession("s3"), "plan-review");

    expect(sm.size).toBe(2);
    expect(sm.get("s1")).toBeUndefined();
    expect(sm.get("s2")).toBeDefined();
    expect(sm.get("s3")).toBeDefined();
  });

  test("disposeAll aborts active sessions and clears", () => {
    const sm = new SessionManager();
    const s1 = mockSession("s1");
    sm.track(s1, "plan-review");
    sm.disposeAll();
    expect(sm.size).toBe(0);
  });

  test("remapId moves entry to new key and keeps alias", () => {
    const sm = new SessionManager();
    sm.track(mockSession("placeholder-1"), "plan-review");

    sm.remapId("placeholder-1", "real-sdk-id");

    // Both old and new IDs resolve to the same entry
    expect(sm.get("real-sdk-id")).toBeDefined();
    expect(sm.get("placeholder-1")).toBeDefined();
    expect(sm.get("placeholder-1")).toBe(sm.get("real-sdk-id"));
  });

  test("track wires onIdResolved callback with alias", () => {
    const sm = new SessionManager();
    const session = mockSession("temp-id");
    sm.track(session, "plan-review");

    expect(session.onIdResolved).toBeDefined();
    session.onIdResolved!("temp-id", "real-id");

    // Both IDs work
    expect(sm.get("real-id")).toBeDefined();
    expect(sm.get("temp-id")).toBeDefined();
    expect(sm.get("temp-id")).toBe(sm.get("real-id"));
  });

  test("remove cleans up aliases", () => {
    const sm = new SessionManager();
    sm.track(mockSession("temp"), "plan-review");
    sm.remapId("temp", "real");

    sm.remove("real");
    expect(sm.get("real")).toBeUndefined();
    expect(sm.get("temp")).toBeUndefined();
    expect(sm.size).toBe(0);
  });

  test("remove via alias also works", () => {
    const sm = new SessionManager();
    sm.track(mockSession("temp"), "plan-review");
    sm.remapId("temp", "real");

    sm.remove("temp"); // remove via alias
    expect(sm.get("real")).toBeUndefined();
    expect(sm.get("temp")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

describe("Context builders", () => {
  test("buildSystemPrompt for plan-review", () => {
    const ctx: AIContext = {
      mode: "plan-review",
      plan: { plan: "# My Plan\n\nStep 1: do things" },
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("plan review tool");
    expect(prompt).toContain("# My Plan");
    expect(prompt).toContain("Step 1: do things");
  });

  test("buildSystemPrompt for code-review", () => {
    const ctx: AIContext = {
      mode: "code-review",
      review: { patch: "diff --git a/foo.ts b/foo.ts\n+hello" },
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("code review tool");
    expect(prompt).toContain("diff --git");
  });

  test("buildSystemPrompt for annotate", () => {
    const ctx: AIContext = {
      mode: "annotate",
      annotate: { content: "# Doc\nSome content", filePath: "/tmp/test.md" },
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("annotation tool");
    expect(prompt).toContain("/tmp/test.md");
  });

  test("buildForkPreamble includes context and instructions", () => {
    const ctx: AIContext = {
      mode: "plan-review",
      plan: {
        plan: "# Plan\nDetails here",
        annotations: "- Remove section 3",
      },
      parent: { sessionId: "parent-123", cwd: "/project" },
    };
    const preamble = buildForkPreamble(ctx);
    expect(preamble).toContain("reviewing your work in Plannotator");
    expect(preamble).toContain("# Plan");
    expect(preamble).toContain("Remove section 3");
  });

  test("buildForkPreamble for code-review with selected code", () => {
    const ctx: AIContext = {
      mode: "code-review",
      review: {
        patch: "+new line",
        filePath: "src/auth.ts",
        selectedCode: "function verify()",
        lineRange: { start: 10, end: 15, side: "new" },
      },
      parent: { sessionId: "p", cwd: "/proj" },
    };
    const preamble = buildForkPreamble(ctx);
    expect(preamble).toContain("src/auth.ts");
    expect(preamble).toContain("function verify()");
    expect(preamble).toContain("Lines 10-15");
  });

  test("truncates very long plans", () => {
    const longPlan = "x".repeat(100_000);
    const ctx: AIContext = {
      mode: "plan-review",
      plan: { plan: longPlan },
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("[truncated for context window]");
    expect(prompt.length).toBeLessThan(longPlan.length);
  });
});

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

describe("ProviderRegistry", () => {
  test("register, get, list, dispose", () => {
    const reg = new ProviderRegistry();
    const p = mockProvider("test-provider");
    reg.register(p);

    expect(reg.get("test-provider")).toBe(p);
    expect(reg.getDefault()).toBe(p);
    expect(reg.list()).toEqual(["test-provider"]);

    reg.dispose("test-provider");
    expect(reg.get("test-provider")).toBeUndefined();
    expect(reg.list()).toEqual([]);
  });

  test("register with custom instance ID", () => {
    const reg = new ProviderRegistry();
    const p = mockProvider("claude-agent-sdk");
    const id = reg.register(p, "claude-fast");

    expect(id).toBe("claude-fast");
    expect(reg.get("claude-fast")).toBe(p);
    expect(reg.get("claude-agent-sdk")).toBeUndefined();
  });

  test("multiple instances of same provider type", () => {
    const reg = new ProviderRegistry();
    const p1 = mockProvider("claude-agent-sdk");
    const p2 = mockProvider("claude-agent-sdk");

    reg.register(p1, "claude-review");
    reg.register(p2, "claude-plan");

    expect(reg.size).toBe(2);
    expect(reg.get("claude-review")).toBe(p1);
    expect(reg.get("claude-plan")).toBe(p2);

    const byType = reg.getByType("claude-agent-sdk");
    expect(byType.length).toBe(2);
  });

  test("mixed provider types", () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider("claude-agent-sdk"), "claude-1");
    reg.register(mockProvider("opencode"), "oc-1");

    expect(reg.size).toBe(2);
    expect(reg.getByType("claude-agent-sdk").length).toBe(1);
    expect(reg.getByType("opencode").length).toBe(1);
  });

  test("disposeAll clears everything", () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider("a"));
    reg.register(mockProvider("b"));
    reg.disposeAll();
    expect(reg.size).toBe(0);
  });

  test("createProvider via factory (does not auto-register)", async () => {
    registerProviderFactory("test-factory", async (config) => {
      return mockProvider(config.type);
    });

    const provider = await createProvider({ type: "test-factory" });
    expect(provider.name).toBe("test-factory");

    // Should NOT be auto-registered in any registry
    const reg = new ProviderRegistry();
    expect(reg.get("test-factory")).toBeUndefined();
  });

  test("createProvider throws for unknown type", async () => {
    await expect(createProvider({ type: "unknown-xyz" })).rejects.toThrow(
      "No AI provider factory"
    );
  });
});

// ---------------------------------------------------------------------------
// AI endpoints
// ---------------------------------------------------------------------------

describe("AI endpoints", () => {
  function setup() {
    const reg = new ProviderRegistry();
    const sm = new SessionManager();
    const endpoints = createAIEndpoints({ registry: reg, sessionManager: sm });
    return { reg, sm, endpoints };
  }

  test("capabilities returns available: false when no provider", async () => {
    const { endpoints } = setup();

    const res = await endpoints["/api/ai/capabilities"](
      new Request("http://localhost/api/ai/capabilities")
    );
    const data = await res.json();
    expect(data.available).toBe(false);
    expect(data.defaultProvider).toBeNull();
  });

  test("capabilities returns provider info when registered", async () => {
    const { reg, endpoints } = setup();
    reg.register(mockProvider("mock"));

    const res = await endpoints["/api/ai/capabilities"](
      new Request("http://localhost/api/ai/capabilities")
    );
    const data = await res.json();
    expect(data.available).toBe(true);
    expect(data.defaultProvider).toBe("mock");
    expect(data.providers).toEqual(["mock"]);
    expect(data.capabilities.fork).toBe(true);
  });

  test("capabilities lists multiple providers", async () => {
    const { reg, endpoints } = setup();
    reg.register(mockProvider("claude-agent-sdk"), "claude-1");
    reg.register(mockProvider("opencode"), "oc-1");

    const res = await endpoints["/api/ai/capabilities"](
      new Request("http://localhost/api/ai/capabilities")
    );
    const data = await res.json();
    expect(data.providers.length).toBe(2);
    expect(data.providers).toContain("claude-1");
    expect(data.providers).toContain("oc-1");
  });

  test("session creation and query flow", async () => {
    const { reg, sm, endpoints } = setup();
    reg.register(mockProvider("mock"));

    // Create session
    const createRes = await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "plan-review", plan: { plan: "# Test" } },
        }),
      })
    );
    const createData = (await createRes.json()) as { sessionId: string };
    expect(createData.sessionId).toBeDefined();
    expect(sm.size).toBe(1);

    // Query
    const queryRes = await endpoints["/api/ai/query"](
      new Request("http://localhost/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: createData.sessionId,
          prompt: "What is this plan about?",
        }),
      })
    );
    expect(queryRes.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await queryRes.text();
    expect(text).toContain("Echo: What is this plan about?");
    expect(text).toContain("[DONE]");
  });

  test("session creation with specific provider ID", async () => {
    const { reg, endpoints } = setup();
    reg.register(mockProvider("claude-agent-sdk"), "claude-fast");
    reg.register(mockProvider("opencode"), "oc-default");

    const createRes = await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "plan-review", plan: { plan: "# Test" } },
          providerId: "claude-fast",
        }),
      })
    );
    expect(createRes.status).toBe(200);
  });

  test("session creation fails for unknown provider ID", async () => {
    const { reg, endpoints } = setup();
    reg.register(mockProvider("mock"));

    const createRes = await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "plan-review", plan: { plan: "# Test" } },
          providerId: "nonexistent",
        }),
      })
    );
    expect(createRes.status).toBe(503);
    const data = await createRes.json();
    expect(data.error).toContain("nonexistent");
  });

  test("query with context update prepends to prompt", async () => {
    const { reg, endpoints } = setup();
    reg.register(mockProvider("mock"));

    const createRes = await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "plan-review", plan: { plan: "# Test" } },
        }),
      })
    );
    const { sessionId } = (await createRes.json()) as { sessionId: string };

    const queryRes = await endpoints["/api/ai/query"](
      new Request("http://localhost/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          prompt: "What changed?",
          contextUpdate: "New annotation: section 3 flagged",
        }),
      })
    );
    const text = await queryRes.text();
    expect(text).toContain("Context update");
    expect(text).toContain("section 3 flagged");
    expect(text).toContain("What changed?");
  });

  test("query sets label from first prompt", async () => {
    const { reg, sm, endpoints } = setup();
    reg.register(mockProvider("mock"));

    const createRes = await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "plan-review", plan: { plan: "# Test" } },
        }),
      })
    );
    const { sessionId } = (await createRes.json()) as { sessionId: string };

    // First query should set the label
    await endpoints["/api/ai/query"](
      new Request("http://localhost/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          prompt: "Why did we choose this approach?",
        }),
      })
    );

    const entry = sm.get(sessionId);
    expect(entry?.label).toBe("Why did we choose this approach?");
  });

  test("abort endpoint", async () => {
    const { reg, endpoints } = setup();
    reg.register(mockProvider("mock"));

    const createRes = await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "plan-review", plan: { plan: "# Test" } },
        }),
      })
    );
    const { sessionId } = (await createRes.json()) as { sessionId: string };

    const abortRes = await endpoints["/api/ai/abort"](
      new Request("http://localhost/api/ai/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
    );
    const abortData = (await abortRes.json()) as { ok: boolean };
    expect(abortData.ok).toBe(true);
  });

  test("sessions list endpoint", async () => {
    const { reg, endpoints } = setup();
    reg.register(mockProvider("mock"));

    await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "plan-review", plan: { plan: "# A" } },
        }),
      })
    );
    await endpoints["/api/ai/session"](
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { mode: "code-review", review: { patch: "+x" } },
        }),
      })
    );

    const listRes = await endpoints["/api/ai/sessions"](
      new Request("http://localhost/api/ai/sessions")
    );
    const sessions = (await listRes.json()) as Array<{ mode: string }>;
    expect(sessions.length).toBe(2);
  });
});
