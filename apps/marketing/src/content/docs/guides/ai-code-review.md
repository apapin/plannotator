---
title: "AI Code Review Agents"
description: "Automated code review using Codex and Claude Code agents with live findings, severity classification, and full prompt transparency."
sidebar:
  order: 26
section: "Guides"
---

Plannotator can launch AI review agents that analyze your code changes and produce structured findings directly in the diff viewer. Agents run as background processes with live log streaming — you continue reviewing while they work.

## Overview

When reviewing code (local changes or a PR), click **Run Agent** in the Agents tab to launch a review. Two providers are supported:

- **Codex CLI** — uses OpenAI's Codex with structured output schema and priority-based findings (P0–P3)
- **Claude Code** — uses Anthropic's Claude with a multi-agent pipeline and severity-based findings (Important / Nit / Pre-existing)

Each provider has its own review model. Findings appear as annotations in the diff viewer, sorted by severity, with inline reasoning explaining how each issue was verified.

Our Claude integration is derived from Anthropic's official [Claude Code Review](https://code.claude.com/docs/en/code-review) service and the open-source [code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md). Our Codex integration is based on [OpenAI Codex CLI](https://github.com/openai/codex) and its structured output capabilities. We adapted both for Plannotator's interactive review UI — the underlying review methodology comes from each provider's official tooling.

## How it works

```
User clicks Run Agent (Codex or Claude)
        ↓
Server builds the review command with appropriate prompt + schema
        ↓
Agent process spawns in the background
        ↓
Live logs stream to the Logs tab in real time
        ↓
On completion, findings are parsed and injected as annotations
        ↓
Annotations appear inline in the diff viewer + in the Findings tab
```

For PR reviews, a local worktree is created by default so the agent has full file access. Use `--no-local` to opt out.

## Findings

Each finding includes:

- **File and line range** — pinpointed to the specific code
- **Description** — what's wrong and why it matters
- **Severity** (Claude) or **Priority** (Codex) — how urgent the fix is
- **Reasoning** (Claude) — the validation chain explaining how the issue was confirmed

Findings are clickable — clicking navigates to the file and highlights the annotation. Copy buttons on each finding and a "Copy All" action export findings as structured markdown.

### Claude severity levels

| Severity | Meaning |
|----------|---------|
| **Important** | A bug to fix before merging — build failures, logic errors, security vulnerabilities |
| **Nit** | Minor issue worth fixing but non-blocking — style deviations, edge cases, code quality |
| **Pre-existing** | A bug in surrounding code not introduced by this PR |

### Codex priority levels

| Priority | Meaning |
|----------|---------|
| **P0** | Drop everything to fix — blocking |
| **P1** | Urgent — address in the next cycle |
| **P2** | Normal — to be fixed eventually |
| **P3** | Low — nice to have |

## Local worktree

For PR/MR reviews, Plannotator automatically creates a temporary local checkout so agents can read files, follow imports, and understand the codebase — not just the diff.

- **Same-repo PRs**: fast git worktree (shared objects, no network transfer for files)
- **Cross-repo PRs**: shallow clone with targeted fetch of the PR head

The worktree is cleaned up automatically when the review session ends. Use `--no-local` to skip worktree creation and review in remote-only mode.

## Transparency

Plannotator is fully transparent about what it sends to AI providers. Every prompt, schema, and command is visible in the review UI and documented here.

### Claude Code review prompt

Claude uses a multi-agent pipeline with 4 parallel review agents and a validation step:

```
Step 1: Gather context
  - Retrieve the PR diff
  - Read CLAUDE.md and REVIEW.md at the repo root and in modified directories
  - Build a map of which rules apply to which file paths

Step 2: Launch 4 parallel review agents
  Agent 1 — Bug + Regression (Opus-level reasoning)
  Agent 2 — Security + Deep Analysis (Opus-level reasoning)
  Agent 3 — Code Quality + Reusability (Sonnet-level reasoning)
  Agent 4 — Guideline Compliance (Haiku-level reasoning)

Step 3: Validate each candidate finding
  For each candidate, a validation agent traces the actual code path,
  checks if the issue is handled elsewhere, and confirms with high
  confidence. Failed validations are silently dropped.

Step 4: Classify as important / nit / pre_existing

Step 5: Deduplicate and rank by severity

Step 6: Return structured JSON findings
```

**Hard constraints enforced in the prompt:**
- Never approve or block the PR
- Never comment on formatting or code style unless guidance files say to
- Never flag missing test coverage unless guidance files say to
- Never invent rules — only enforce what CLAUDE.md or REVIEW.md state
- Prefer silence over false positives

### Claude Code command

```bash
claude -p \
  --permission-mode dontAsk \
  --output-format stream-json \
  --verbose \
  --json-schema <schema> \
  --no-session-persistence \
  --model sonnet \
  --tools Agent,Bash,Read,Glob,Grep \
  --allowedTools <allowlist> \
  --disallowedTools <denylist>
```

The prompt is written to stdin. The `--json-schema` flag enforces structured output with findings, severity, and reasoning fields.

### Claude allowed tools

The agent can use these tools during review:

| Category | Tools |
|----------|-------|
| **Built-in** | Agent (subagents), Read, Glob, Grep |
| **GitHub CLI** | `gh pr view/diff/list`, `gh issue view/list`, `gh api repos/*/pulls/*` |
| **GitLab CLI** | `glab mr view/diff/list`, `glab api` |
| **Git (read-only)** | `git status/diff/log/show/blame/branch/grep/ls-remote/ls-tree/merge-base/remote/rev-parse/show-ref` |
| **Utility** | `wc` (word/line count) |

**Explicitly blocked:** Edit, Write, WebFetch, WebSearch, Python, Node, Bash shells (sh/bash/zsh), curl, wget. The agent is read-only — it cannot modify your code.

### Codex review prompt

Codex uses OpenAI's structured output with a review-specific system prompt adapted from the [Codex CLI review guidelines](https://github.com/openai/codex):

- Focus on bugs the original author would fix if they knew about them
- One finding per distinct issue with minimal line ranges
- Priority tagging (P0–P3) based on severity
- Overall correctness verdict at the end

### Codex command

```bash
codex exec \
  --output-schema <schema-path> \
  -o <output-file> \
  --full-auto \
  --ephemeral \
  -C <working-directory> \
  "<prompt>"
```

Codex writes structured JSON to the output file. The schema enforces findings with title, body, confidence score, priority, and code location.

### Output schemas

**Claude schema:**
```json
{
  "findings": [{
    "severity": "important | nit | pre_existing",
    "file": "path/to/file.ts",
    "line": 42,
    "end_line": 45,
    "description": "What's wrong",
    "reasoning": "How it was verified"
  }],
  "summary": {
    "important": 2,
    "nit": 1,
    "pre_existing": 0
  }
}
```

**Codex schema:**
```json
{
  "findings": [{
    "title": "[P1] Issue summary",
    "body": "Detailed explanation",
    "confidence_score": 0.95,
    "priority": 1,
    "code_location": {
      "absolute_file_path": "/path/to/file.ts",
      "line_range": { "start": 42, "end": 45 }
    }
  }],
  "overall_correctness": "Incorrect",
  "overall_explanation": "Summary of verdict",
  "overall_confidence_score": 0.85
}
```

## Security notes

- **Read-only agents**: Review agents cannot modify your code. Edit, Write, and shell execution tools are explicitly blocked.
- **No external network access**: WebFetch, WebSearch, curl, and wget are blocked. Agents can only read local files and use `gh`/`glab` CLI for platform API access.
- **Local execution**: Agents run on your machine as background processes. No code is sent to Plannotator servers — all AI communication goes directly to the provider (Anthropic or OpenAI).
- **Temporary worktrees**: Local checkouts are created in system temp directories and cleaned up on session end. They use shallow clones or detached worktrees to minimize disk usage.
- **CLAUDE.md / REVIEW.md**: The Claude agent reads these files to understand project conventions. These files are part of your repository and under your control.
- **No GitHub commenting**: Agents never post comments, approve, or block PRs. All findings stay in the Plannotator UI unless you explicitly use "Post Comments" to submit them.

## Customization

### CLAUDE.md

Add a `CLAUDE.md` file to your repository root or any subdirectory. The Claude review agent reads it to understand project-specific rules:

```markdown
# Code Review Rules

- Always check for SQL injection in database queries
- Skip test fixtures in test-fixtures/
- Enforce snake_case for Python files
```

### REVIEW.md

Similar to CLAUDE.md but specifically for review rules. Both files are additive — REVIEW.md adds to CLAUDE.md, it doesn't replace it.
