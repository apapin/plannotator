# OpenCode Workflow Modes

## Status

Draft proposal for issue [#479](https://github.com/backnotprop/plannotator/issues/479).

## Context

Plannotator's OpenCode plugin currently exposes `submit_plan` broadly to primary
agents and nudges agents toward using it for plan review. This works well for
users who want Plannotator to own the plan approval loop, but recent feedback
shows three distinct workflows:

1. Users who want Plannotator to integrate with OpenCode plan mode.
2. Users who want manual review through `/plannotator-last` and
   `/plannotator-annotate`.
3. Users who want the legacy behavior where any primary agent can submit plans.

The current implementation blurs those workflows. In particular, non-plan
primary agents can still see `submit_plan`, and some users experience the tool
as eager or intrusive during small plans, OpenSpec-style artifact planning, or
normal OpenCode flow.

This spec makes those workflows explicit.

## Goals

- Keep OpenCode plan-mode integration as a first-class feature.
- Make `/plannotator-last` and `/plannotator-annotate` first-class manual
  features, not fallback paths.
- Stop broad primary-agent exposure by default.
- Preserve the current broad behavior as an explicit compatibility mode.
- Support users who want Plannotator to gate plans created by configured
  planning agents.
- Support users who want native OpenCode planning plus manual Plannotator
  review through commands.

## Non-Goals

- Remove OpenCode plan-mode integration.
- Replace OpenCode's native plan mode.
- Make browser UI settings the source of truth for tool registration.
- Add a new `/plannotator-last-plan` command as part of the first phase.

`/plannotator-last-plan` may still be useful later, but current Pi and OpenCode
feedback suggests `/plannotator-last` and `/plannotator-annotate` already cover
the most valuable manual entry points.

## User-Facing Modes

### `manual`

Manual review mode.

Behavior:

- Do not register `submit_plan`.
- Do not inject Plannotator plan-submission prompts.
- Do not rewrite `plan_exit` or `todowrite`.
- Keep manual commands available:
  - `/plannotator-last`
  - `/plannotator-annotate`
  - `/plannotator-review`
  - `/plannotator-archive`
- Let OpenCode planning behave natively.

This does not mean Plannotator is not part of planning. It means Plannotator
does not automatically interrupt planning. Users can still run
`/plannotator-last` on a plan message or `/plannotator-annotate` on a spec,
plan file, directory, or URL.

### `plan-agent`

Scoped automatic plan review mode. This should be the first migration default.

Behavior:

- Register `submit_plan`.
- Expose `submit_plan` only to configured planning agents.
- Hide or deny `submit_plan` for non-planning agents using OpenCode agent
  permissions where possible.
- Also reject calls in `submit_plan.execute()` if `context.agent` is not in the
  configured planning-agent list.
- Inject Plannotator planning guidance only for configured planning agents.
- Do not inject the lightweight "Plan Submission" reminder into arbitrary
  primary agents.

This mode is for users who want Plannotator integrated with OpenCode plan mode,
without letting `build` or other implementation agents call `submit_plan`.

### `all-agents`

Legacy broad automatic mode.

Behavior:

- Preserve today's broad behavior as much as practical.
- Register `submit_plan`.
- Allow primary agents to call `submit_plan`.
- Keep subagent behavior governed by the existing `primary_tools`/subagent
  hiding mechanism unless explicitly overridden.

This mode exists for users who intentionally rely on the current broad access
model.

## Proposed Config

OpenCode plugin-specific config should live in plugin tuple options, not a
top-level `plannotator` key.

```json
{
  "plugin": [
    ["@plannotator/opencode@latest", {
      "workflow": "plan-agent",
      "planningAgents": ["plan"]
    }]
  ]
}
```

Fields:

- `workflow`: `"manual" | "plan-agent" | "all-agents"`
- `planningAgents`: string array, default `["plan"]`

Recommended defaults:

```json
{
  "workflow": "plan-agent",
  "planningAgents": ["plan"]
}
```

Environment variables may exist as temporary migration aids, but plugin tuple
options should be the durable interface.

## OpenCode Source Findings

External OpenCode source review answered the main integration questions:

- Plugins can conditionally register tools at startup. If the plugin does not
  return `tool.submit_plan`, the model does not see that tool.
- Plugin tool definitions do not have a native `visibleTo` field.
- OpenCode does filter tools through active agent permissions, and plugin tool
  names can be controlled through the permission catchall. This allows
  `agent.<name>.permission.submit_plan = "deny"` for non-planning agents.
- Plugin tool execution receives the invoking agent as `context.agent`.
- `client.session.prompt({ agent })` selects the agent for that specific prompt;
  it does not generally mutate the TUI's selected agent.
- There is no plugin-native "approve but do not continue" primitive. To approve
  without continuing, do not call `session.prompt()`.
- Top-level OpenCode config is strict, so plugin-specific settings belong in
  plugin tuple options.

## Implementation Design

### Options Parsing

Add an options schema near the OpenCode plugin entry:

```ts
type WorkflowMode = "manual" | "plan-agent" | "all-agents";

interface PlannotatorOpenCodeOptions {
  workflow?: WorkflowMode;
  planningAgents?: string[];
}
```

Normalize options once at plugin startup:

- invalid or missing `workflow` -> `plan-agent`
- empty or missing `planningAgents` -> `["plan"]`
- agent names should be trimmed and deduplicated

### Tool Registration

Build the plugin return object conditionally:

- `manual`: omit `tool.submit_plan`
- `plan-agent`: include `tool.submit_plan`
- `all-agents`: include `tool.submit_plan`

This keeps OpenCode plan-mode integration working by default while removing the
broad non-plan-agent exposure that causes eager calls from implementation
agents.

### Config Hook

Mode-specific behavior:

- `manual`
  - do not add `submit_plan` to `experimental.primary_tools`
  - do not mutate `agent.plan.permission.edit`
  - do not add `submit_plan` permissions

- `plan-agent`
  - add `submit_plan` to `experimental.primary_tools` to keep it hidden from
    subagents by default
  - allow markdown editing for configured planning agents if needed
  - deny `submit_plan` for known non-planning primary agents where OpenCode
    agent config is available

- `all-agents`
  - preserve current primary-agent behavior
  - keep `experimental.primary_tools` subagent hiding unless
    `PLANNOTATOR_ALLOW_SUBAGENTS` is enabled

### Prompt Hooks

Mode-specific behavior:

- `manual`
  - no Plannotator prompt injection
  - no `STRICTLY FORBIDDEN` replacement
  - no `plan_exit` or `todowrite` description rewrites

- `plan-agent`
  - inject only for configured planning agents
  - do not inject the lightweight reminder into other primary agents
  - keep the `plan_exit` and `todowrite` tool-definition rewrites as mild
    global compatibility adjustments because OpenCode's `tool.definition` hook
    does not expose active-agent context

- `all-agents`
  - preserve current behavior, with any obvious bugs fixed

The `plan_exit` and `todowrite` rewrites are not access control. `submit_plan`
visibility is controlled through OpenCode permission mutation where possible,
and correctness is enforced in `submit_plan.execute()` via `context.agent`.

### Runtime Guard

In `submit_plan.execute()`:

- If workflow is `plan-agent` and `context.agent` is not in `planningAgents`,
  return a clear rejection message instead of opening Plannotator.
- This guard is required even if permissions hide the tool, because permissions
  are a visibility mechanism and runtime enforcement should still be explicit.

Suggested message:

```text
Plannotator is configured for plan-agent mode. submit_plan can only be called by:
plan

Use /plannotator-last or /plannotator-annotate for manual review.
```

### Approval Handoff

Approval should be decoupled from automatic implementation.

Existing behavior sends `session.prompt()` when agent switching is enabled. For
future migration stages:

- `manual`: not applicable because `submit_plan` is not registered
- `plan-agent`: default should be stay/stop; do not call `session.prompt()`
  unless the user explicitly configured a continuation target
- `all-agents`: preserve existing behavior for compatibility

The default agent-switch setting should be revisited separately. The current
fallback to `build` is still too opinionated for many OpenCode workflows, but
it is not part of the first migration stage.

## Manual Features

The following commands should be documented as first-class OpenCode workflows:

### `/plannotator-last`

Review or annotate the most recent assistant response. Useful when an OpenCode
agent produced a plan, explanation, design, or answer that the user wants to
review manually.

### `/plannotator-annotate`

Review arbitrary artifacts:

- markdown files
- directories
- URLs
- specs or plan documents produced by tools such as OpenSpec

This command is especially important for users whose planning process is
artifact-driven instead of chat-plan-driven.

## Migration

The first migration should narrow the default from broad primary-agent exposure
to plan-agent-only exposure. This keeps Plannotator integrated with OpenCode
plan mode while stopping `build` and other non-plan primary agents from seeing
or being nudged toward `submit_plan`.

Default behavior with omitted config:

```json
{
  "workflow": "plan-agent",
  "planningAgents": ["plan"]
}
```

Existing users who want the current broad behavior should opt in:

```json
{
  "plugin": [
    ["@plannotator/opencode@latest", {
      "workflow": "all-agents"
    }]
  ]
}
```

Users who want automatic review only from the plan agent:

```json
{
  "plugin": [
    ["@plannotator/opencode@latest", {
      "workflow": "plan-agent",
      "planningAgents": ["plan"]
    }]
  ]
}
```

Users who want native OpenCode planning plus manual Plannotator review:

```json
{
  "plugin": [
    ["@plannotator/opencode@latest", {
      "workflow": "manual"
    }]
  ]
}
```

## Phased Rollout

### Stage 1: Narrow Default To `plan-agent`

Goal: stop broad primary-agent exposure without removing OpenCode plan
integration.

- Add plugin option parsing.
- Default to `plan-agent`.
- Keep `submit_plan` registered for automatic workflows.
- Omit `submit_plan` only in `manual`.
- Remove the generic `submit_plan` reminder for non-plan primary agents in the
  default mode.
- Inject Plannotator planning guidance only for configured planning agents.
- Patch OpenCode permissions:
  - `build.permission.submit_plan = "deny"`
  - configured planning agents get `submit_plan = "allow"`
  - user-configured non-planning primary agents get `submit_plan = "deny"`
- Add a runtime guard using `context.agent`.
- Keep the `plan_exit` and `todowrite` rewrites for `plan-agent` and
  `all-agents`.
- Preserve current behavior under `all-agents`.
- Support `manual` as commands-only mode.

### Stage 2: Documentation And Migration UX

Goal: make the behavior change understandable.

- Update OpenCode README and website docs.
- Document all three modes.
- Add migration snippets:
  - old behavior: `workflow: "all-agents"`
  - default plan-agent behavior: `workflow: "plan-agent"`
  - commands-only: `workflow: "manual"`
- Update troubleshooting around why `build` cannot call `submit_plan` by
  default.

### Stage 3: Approval Semantics

- Revisit default approval behavior.
- Make stay/stop the default for `plan-agent`.
- Preserve current implementation handoff under `all-agents`.
- Update UI copy to make continuation behavior explicit.

### Stage 4: Optional Manual Plan Command

Only if users ask for plan-specific manual semantics:

- Add `/plannotator-last-plan`.
- Prefer latest assistant message from configured planning agents.
- Open plan-review UI instead of annotate-last mode.

This should not block the first three phases.
