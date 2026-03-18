---
name: add-error-handling
description: Consider edge cases and failure modes
type: smart-action
context: review
metadata:
  emoji: "🛡️"
  author: plannotator
---

Review this code for missing error handling and edge cases:
- What happens when inputs are invalid or missing?
- What are the failure modes for external calls (network, disk, APIs)?
- Are there race conditions or concurrency issues?
- What should the user see when something goes wrong?

Add concrete error handling to address these.
