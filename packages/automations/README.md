# Automations

Preset feedback templates for plan review and code review. Each automation is an `AUTOMATION.md` file that follows a format similar to [Agent Skills](https://agentskills.io) — YAML frontmatter + markdown body.

## File Format

```
automation-name/
├── AUTOMATION.md       # Required: metadata + feedback text
├── icon.svg            # Optional: custom icon (or icon.png)
└── references/         # Optional: additional context
```

### AUTOMATION.md

```markdown
---
name: automation-name               # kebab-case, matches directory name
description: What this does          # shown in dropdown and settings
type: smart-action                   # smart-action | prompt-hook
context: plan                        # plan | review | [plan, review]
metadata:
  emoji: "✨"                        # fallback if no icon file
  author: your-name                  # optional
  repo: https://github.com/...      # optional
  inspired-by:                       # optional
    - name: Reference
      url: https://example.com
---

The markdown body is the feedback text sent to the agent.
```

### Types

- **smart-action** — Fires immediately when clicked. Sends the body as feedback to the agent.
- **prompt-hook** — Toggled on/off. When active, the body gets appended to every feedback submission (approve or deny).

### Context

- `plan` — Available in plan review
- `review` — Available in code review
- `[plan, review]` — Available in both

## Contributing

1. Create a directory in `plan/` or `review/`
2. Write an `AUTOMATION.md` with proper frontmatter
3. Optionally add an `icon.svg` or `icon.png`
4. Open a PR

## User Automations

Users can create custom automations stored at `~/.plannotator/automations/{plan,review}/`. Same file format as library automations.
