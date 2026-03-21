/**
 * Claude Agent SDK provider — the first concrete AIProvider implementation.
 *
 * Uses @anthropic-ai/claude-agent-sdk to create sessions that can:
 * - Start fresh with Plannotator context as the system prompt
 * - Fork from a parent Claude Code session (preserving full history)
 * - Resume a previous Plannotator inline chat session
 * - Stream text deltas back to the UI in real time
 *
 * Sessions are read-only by default (tools limited to Read, Glob, Grep)
 * to keep inline chat safe and cost-bounded.
 */

import { buildSystemPrompt, buildForkPreamble } from "../context.ts";
import type {
  AIProvider,
  AIProviderCapabilities,
  AISession,
  AIMessage,
  AIContext,
  CreateSessionOptions,
  ClaudeAgentSDKConfig,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_NAME = "claude-agent-sdk";

/** Default read-only tools for inline chat. */
const DEFAULT_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "WebSearch"];

/** Sensible defaults for inline chat — keep it fast and cheap. */
const DEFAULT_MAX_TURNS = 3;
const DEFAULT_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// SDK query options — typed to catch typos at compile time
// ---------------------------------------------------------------------------

interface ClaudeSDKQueryOptions {
  model: string;
  maxTurns: number;
  allowedTools: string[];
  cwd: string;
  abortController: AbortController;
  includePartialMessages: boolean;
  persistSession: boolean;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  resume?: string;
  forkSession?: boolean;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ClaudeAgentSDKProvider implements AIProvider {
  readonly name = PROVIDER_NAME;
  readonly capabilities: AIProviderCapabilities = {
    fork: true,
    resume: true,
    streaming: true,
    tools: true,
  };

  private config: ClaudeAgentSDKConfig;

  constructor(config: ClaudeAgentSDKConfig) {
    this.config = config;
  }

  async createSession(options: CreateSessionOptions): Promise<AISession> {
    return new ClaudeAgentSDKSession({
      ...this.baseConfig(options),
      systemPrompt: buildSystemPrompt(options.context),
      cwd: this.config.cwd ?? process.cwd(),
      parentSessionId: null,
      forkFromSession: null,
    });
  }

  async forkSession(options: CreateSessionOptions): Promise<AISession> {
    const parent = options.context.parent;
    if (!parent) {
      throw new Error(
        "Cannot fork: no parent session provided in context. " +
          "Use createSession() for standalone sessions."
      );
    }

    return new ClaudeAgentSDKSession({
      ...this.baseConfig(options),
      systemPrompt: null,
      forkPreamble: buildForkPreamble(options.context),
      cwd: parent.cwd,
      parentSessionId: parent.sessionId,
      forkFromSession: parent.sessionId,
    });
  }

  async resumeSession(
    sessionId: string,
    abortController?: AbortController
  ): Promise<AISession> {
    return new ClaudeAgentSDKSession({
      ...this.baseConfig(),
      systemPrompt: null,
      cwd: this.config.cwd ?? process.cwd(),
      parentSessionId: null,
      forkFromSession: null,
      resumeSessionId: sessionId,
    });
  }

  dispose(): void {
    // No persistent resources to clean up
  }

  private baseConfig(options?: CreateSessionOptions) {
    return {
      context: options?.context ?? null,
      model: options?.model ?? this.config.model ?? DEFAULT_MODEL,
      maxTurns: options?.maxTurns ?? DEFAULT_MAX_TURNS,
      maxBudgetUsd: options?.maxBudgetUsd,
      allowedTools: this.config.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
      permissionMode: this.config.permissionMode ?? "plan",
    };
  }
}

// ---------------------------------------------------------------------------
// SDK import cache — resolve once, reuse across all queries
// ---------------------------------------------------------------------------

let sdkQueryFn: ((args: { prompt: string; options: unknown }) => AsyncIterable<Record<string, unknown>>) | null = null;

async function getSDKQuery() {
  if (!sdkQueryFn) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    sdkQueryFn = sdk.query;
  }
  return sdkQueryFn;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

interface SessionConfig {
  systemPrompt: string | null;
  forkPreamble?: string;
  context: AIContext | null;
  model: string;
  maxTurns: number;
  maxBudgetUsd?: number;
  allowedTools: string[];
  permissionMode: string;
  cwd: string;
  parentSessionId: string | null;
  forkFromSession: string | null;
  resumeSessionId?: string;
}

class ClaudeAgentSDKSession implements AISession {
  readonly parentSessionId: string | null;
  onIdResolved?: (oldId: string, newId: string) => void;

  private config: SessionConfig;
  private _isActive = false;
  private _placeholderId: string;
  private _resolvedId: string | null = null;
  private _currentAbort: AbortController | null = null;

  constructor(config: SessionConfig) {
    this.config = config;
    this.parentSessionId = config.parentSessionId;
    this._placeholderId = config.resumeSessionId ?? crypto.randomUUID();
  }

  get id(): string {
    return this._resolvedId ?? this._placeholderId;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  async *query(prompt: string): AsyncIterable<AIMessage> {
    // Reject concurrent queries — abort the previous one
    if (this._isActive && this._currentAbort) {
      this._currentAbort.abort();
    }

    this._isActive = true;
    this._currentAbort = new AbortController();

    try {
      const queryFn = await getSDKQuery();

      const queryPrompt = this.buildQueryPrompt(prompt);
      const options = this.buildQueryOptions();

      const stream = queryFn({ prompt: queryPrompt, options });

      for await (const message of stream) {
        const mapped = mapSDKMessage(message);

        // Capture the real session ID from the SDK on first occurrence
        if (
          !this._resolvedId &&
          "session_id" in message &&
          typeof message.session_id === "string" &&
          message.session_id
        ) {
          const oldId = this._placeholderId;
          this._resolvedId = message.session_id;
          this.onIdResolved?.(oldId, this._resolvedId);
        }

        yield mapped;
      }
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
        code: "provider_error",
      };
    } finally {
      this._isActive = false;
      this._currentAbort = null;
    }
  }

  abort(): void {
    if (this._currentAbort) {
      this._currentAbort.abort();
      this._isActive = false;
      this._currentAbort = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private buildQueryPrompt(userPrompt: string): string {
    if (this.config.forkPreamble && !this._resolvedId) {
      return `${this.config.forkPreamble}\n\n---\n\nUser question: ${userPrompt}`;
    }
    return userPrompt;
  }

  private buildQueryOptions(): ClaudeSDKQueryOptions {
    const opts: ClaudeSDKQueryOptions = {
      model: this.config.model,
      maxTurns: this.config.maxTurns,
      allowedTools: this.config.allowedTools,
      cwd: this.config.cwd,
      abortController: this._currentAbort!,
      includePartialMessages: true,
      persistSession: true,
    };

    if (this.config.maxBudgetUsd) {
      opts.maxBudgetUsd = this.config.maxBudgetUsd;
    }

    // After the first query resolves a real session ID, all subsequent
    // queries must resume that session to continue the conversation.
    if (this._resolvedId) {
      opts.resume = this._resolvedId;
      return this.applyPermissionMode(opts);
    }

    // First query: apply initial session setup
    if (this.config.systemPrompt) {
      opts.systemPrompt = this.config.systemPrompt;
    }

    if (this.config.forkFromSession) {
      opts.resume = this.config.forkFromSession;
      opts.forkSession = true;
    }

    if (this.config.resumeSessionId) {
      opts.resume = this.config.resumeSessionId;
    }

    return this.applyPermissionMode(opts);
  }

  private applyPermissionMode(opts: ClaudeSDKQueryOptions): ClaudeSDKQueryOptions {
    if (this.config.permissionMode === "bypassPermissions") {
      opts.permissionMode = "bypassPermissions";
      opts.allowDangerouslySkipPermissions = true;
    } else if (this.config.permissionMode === "plan") {
      opts.permissionMode = "plan";
    }
    return opts;
  }
}

// ---------------------------------------------------------------------------
// Message mapping
// ---------------------------------------------------------------------------

/**
 * Map an SDK message to an AIMessage.
 * Unknown message types are passed through as AIUnknownMessage for transparency.
 */
function mapSDKMessage(msg: Record<string, unknown>): AIMessage {
  const type = msg.type as string;

  switch (type) {
    case "assistant": {
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) return { type: "unknown", raw: msg };
      const content = message.content as Array<Record<string, unknown>>;
      if (!content) return { type: "unknown", raw: msg };

      const textParts: string[] = [];
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          return {
            type: "tool_use",
            toolName: block.name as string,
            toolInput: block.input as Record<string, unknown>,
            toolUseId: block.id as string,
          };
        }
      }
      if (textParts.length > 0) {
        return { type: "text", text: textParts.join("") };
      }
      return { type: "unknown", raw: msg };
    }

    case "stream_event": {
      const event = msg.event as Record<string, unknown> | undefined;
      if (!event) return { type: "unknown", raw: msg };
      const eventType = event.type as string;

      if (eventType === "content_block_delta") {
        const delta = event.delta as Record<string, unknown>;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          return { type: "text_delta", delta: delta.text };
        }
      }
      return { type: "unknown", raw: msg };
    }

    case "tool_result": {
      // Tool results from Read, Glob, Grep, WebSearch etc.
      return {
        type: "tool_result",
        toolUseId: (msg.tool_use_id as string) ?? "",
        result: typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content ?? ""),
      };
    }

    case "result": {
      const sessionId = (msg.session_id as string) ?? "";
      const subtype = msg.subtype as string;
      return {
        type: "result",
        sessionId,
        success: subtype === "success",
        result: (msg.result as string) ?? undefined,
        costUsd: msg.total_cost_usd as number | undefined,
        turns: msg.num_turns as number | undefined,
      };
    }

    default:
      return { type: "unknown", raw: msg };
  }
}

// ---------------------------------------------------------------------------
// Factory registration
// ---------------------------------------------------------------------------

import { registerProviderFactory } from "../provider.ts";

registerProviderFactory(
  PROVIDER_NAME,
  async (config) => new ClaudeAgentSDKProvider(config as ClaudeAgentSDKConfig)
);
