---
title: "AI Code Review Agents"
description: "Automated code review using Codex and Claude Code agents with live findings, severity classification, and full prompt transparency."
sidebar:
  order: 26
section: "Guides"
---

Launch AI review agents from the Plannotator diff viewer. Agents analyze your changes in the background and produce structured findings inline.

Two providers are supported:

- **Codex CLI** uses priority-based findings (P0 through P3)
- **Claude Code** uses a multi-agent pipeline with severity-based findings (Important, Nit, Pre-existing)

Both integrations are derived from official tooling. Claude's review model is based on Anthropic's [Claude Code Review](https://code.claude.com/docs/en/code-review) service and the open-source [code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md). Codex uses [OpenAI Codex CLI](https://github.com/openai/codex) structured output.

## Flow

1. Click **Run Agent** in the Agents tab (choose Codex or Claude)
2. The server builds the command with the appropriate prompt and schema
3. Agent runs in the background; live logs stream to the Logs tab
4. On completion, findings are parsed and appear as inline annotations

For PR reviews, a temporary local checkout is created by default so the agent has file access beyond the diff. Pass `--no-local` to skip this.

## Findings

Each finding includes a file path, line range, description, and severity or priority. Claude findings also include a reasoning trace that explains how the issue was verified.

Click any finding to navigate to the relevant file and line. Use the copy button on individual findings or "Copy All" to export as markdown.

### Severity (Claude)

| Level | Meaning |
|-------|---------|
| **Important** | Fix before merging. Build failures, logic errors, security issues. |
| **Nit** | Worth fixing, not blocking. Style, edge cases, code quality. |
| **Pre-existing** | Bug in surrounding code, not introduced by this PR. |

### Priority (Codex)

| Level | Meaning |
|-------|---------|
| **P0** | Blocking. Drop everything. |
| **P1** | Urgent. Next cycle. |
| **P2** | Normal. Fix eventually. |
| **P3** | Low. Nice to have. |

## Local worktree

PR and MR reviews automatically create a temporary checkout so agents can read files, follow imports, and understand the codebase.

- **Same-repo**: git worktree (shared objects, fast)
- **Cross-repo**: shallow clone with targeted PR head fetch

Cleaned up when the session ends. Use `--no-local` to review in remote-only mode.

## Transparency

Every prompt, schema, and command is visible in the review UI under the "Prompt" and "Review Prompt" disclosures. Full details below.

### Claude review pipeline

Claude spawns 4 parallel review agents, validates each candidate finding, then returns structured JSON.

```
1. Gather context
   Read the diff, CLAUDE.md, and REVIEW.md files

2. Parallel review agents
   Agent 1  Bug + Regression          (Opus-level)
   Agent 2  Security + Deep Analysis  (Opus-level)
   Agent 3  Code Quality              (Sonnet-level)
   Agent 4  Guideline Compliance      (Haiku-level)

3. Validate findings
   Each candidate is traced through the code to confirm it is real.
   Failed validations are dropped silently.

4. Classify  →  important / nit / pre_existing
5. Deduplicate and rank by severity
6. Return structured JSON
```

Hard constraints in the prompt:

- Never approve or block the PR
- Never flag formatting, style, or missing tests unless guidance files say to
- Never invent rules. Only enforce what CLAUDE.md or REVIEW.md state.
- Prefer silence over false positives

### Claude command

```bash
claude -p \
  --permission-mode dontAsk \
  --output-format stream-json \
  --json-schema <schema> \
  --no-session-persistence \
  --model sonnet \
  --allowedTools <allowlist> \
  --disallowedTools <denylist>
```

Prompt is written to stdin. The schema enforces findings with severity, description, and reasoning fields.

### Claude allowed tools

| Category | Tools |
|----------|-------|
| Built-in | Agent, Read, Glob, Grep |
| GitHub | `gh pr view/diff/list`, `gh issue view/list`, `gh api` |
| GitLab | `glab mr view/diff/list`, `glab api` |
| Git | `status`, `diff`, `log`, `show`, `blame`, `branch`, `grep`, `merge-base`, and other read-only commands |
| Utility | `wc` |

Blocked: Edit, Write, WebFetch, WebSearch, Python, Node, shell interpreters, curl, wget. The agent is read-only.

### Codex review prompt

Adapted from the [Codex CLI review guidelines](https://github.com/openai/codex):

- Flag bugs the author would fix if they knew
- One finding per issue, minimal line ranges
- Priority tagging P0 through P3
- Overall correctness verdict

### Codex command

```bash
codex exec \
  --output-schema <path> \
  -o <output-file> \
  --full-auto --ephemeral \
  -C <working-directory> \
  "<prompt>"
```

Results are written as structured JSON to the output file.

### Output schemas

Claude:

```json
{
  "findings": [{
    "severity": "important",
    "file": "src/auth.ts",
    "line": 42,
    "end_line": 45,
    "description": "What is wrong",
    "reasoning": "How it was verified"
  }],
  "summary": { "important": 2, "nit": 1, "pre_existing": 0 }
}
```

Codex:

```json
{
  "findings": [{
    "title": "[P1] Issue summary",
    "body": "Explanation",
    "confidence_score": 0.95,
    "priority": 1,
    "code_location": {
      "absolute_file_path": "/repo/src/auth.ts",
      "line_range": { "start": 42, "end": 45 }
    }
  }],
  "overall_correctness": "Incorrect",
  "overall_explanation": "Summary",
  "overall_confidence_score": 0.85
}
```

## Security

**Read-only.** Agents cannot modify code. Edit, Write, and shell execution are blocked.

**No network.** WebFetch, WebSearch, curl, and wget are blocked. Agents access the platform API only through `gh` or `glab`.

**Local execution.** Agents run on your machine. No code goes to Plannotator servers. AI communication goes directly to the provider.

**Temp worktrees.** Checkouts use system temp directories and are cleaned up on session end.

**No commenting.** Agents never post to GitHub or GitLab. Findings stay in the UI unless you explicitly submit them.

## Customization

Add `CLAUDE.md` or `REVIEW.md` to your repo root or any subdirectory. The Claude agent reads them to understand project rules.

```markdown
# Review Rules

- Check for SQL injection in database queries
- Skip files in test-fixtures/
- Enforce snake_case in Python
```

Both files are additive. REVIEW.md extends CLAUDE.md for review-specific guidance.
