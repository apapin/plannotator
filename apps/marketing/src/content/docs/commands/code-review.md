---
title: "Code Review"
description: "The /plannotator-review slash command for reviewing uncommitted code changes or GitHub pull requests."
sidebar:
  order: 11
section: "Commands"
---

The `/plannotator-review` command opens an interactive code review UI for your uncommitted changes or a GitHub pull request.

## Usage

**Review uncommitted changes:**

```
/plannotator-review
```

**Review a GitHub pull request:**

```
/plannotator-review https://github.com/owner/repo/pull/123
```

PR review uses the `gh` CLI for authentication, so private repos work automatically if you're authenticated with `gh auth login`.

## How it works

**Local review:**

```
User runs /plannotator-review
        ↓
Agent runs: plannotator review
        ↓
git diff captures unstaged changes
        ↓
Review server starts, opens browser with diff viewer
        ↓
User annotates code, provides feedback
        ↓
Send Feedback → feedback sent to agent
Approve → "LGTM" sent to agent
```

**PR review:**

```
User runs /plannotator-review <github-url>
        ↓
Agent runs: plannotator review <github-url>
        ↓
gh CLI fetches PR diff and metadata
        ↓
Review server starts, opens browser with diff viewer
        ↓
User annotates code, provides feedback
        ↓
Send Feedback → PR context included in feedback
Approve → "LGTM" sent to agent
```

## The diff viewer

The review UI shows your changes in a familiar diff format:

- **File tree sidebar** — Navigate between changed files
- **Viewed tracking** — Mark files as viewed to track progress
- **Unified diff** — See additions and deletions in context
- **Annotation tools** — Same annotation types as plan review (delete, replace, comment, insert)

## Annotating code

Select any text in the diff to annotate it, just like in plan review. Your annotations are exported as structured feedback referencing specific lines and files.

## Ask AI

When an AI provider is available, the diff viewer includes inline AI chat. Select lines in the diff and choose "Ask AI" to ask questions about the code. Responses stream into a sidebar panel grouped by file.

### Supported providers

Plannotator supports multiple AI providers. Providers are auto-detected based on which CLI tools are installed on your system:

- **Claude** — Requires the `claude` CLI ([Claude Code](https://docs.anthropic.com/en/docs/claude-code))
- **Codex** — Requires the `codex` CLI ([OpenAI Codex](https://github.com/openai/codex))

Both providers can be available simultaneously. Plannotator does not manage API keys — you must be authenticated with each CLI independently (`claude` uses `~/.claude/` credentials, `codex` uses `OPENAI_API_KEY`).

### Choosing a provider

When multiple providers are available, set your default in **Settings → AI**. The AI tab shows all detected providers as selectable cards. Your choice persists across sessions.

If only one provider is installed, it's used automatically — no configuration needed.

## Submitting feedback

- **Send Feedback** — Formats your annotations and sends them to the agent
- **Approve** — Sends "LGTM" to the agent, indicating the changes look good

After submission, the agent receives your feedback and can act on it — fixing issues, explaining decisions, or making the requested changes.

## Server API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/diff` | GET | Returns `{ rawPatch, gitRef, origin }` |
| `/api/feedback` | POST | Submit review feedback |
| `/api/image` | GET | Serve image by path |
| `/api/upload` | POST | Upload image attachment |
| `/api/ai/capabilities` | GET | Check available AI providers |
| `/api/ai/session` | POST | Create AI chat session |
| `/api/ai/query` | POST | Send prompt, stream SSE response |
| `/api/ai/abort` | POST | Abort current AI query |
| `/api/ai/permission` | POST | Respond to tool approval request |
