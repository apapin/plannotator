---
name: simplify-approach
description: Reduce complexity, remove over-engineering
type: smart-action
context: plan
metadata:
  emoji: "✂️"
  author: plannotator
---

This plan is over-engineered. Simplify it:
- Remove abstractions that only have one consumer
- Prefer inline code over utility functions for one-off operations
- Cut any features not explicitly requested
- Identify the minimal set of changes needed to achieve the goal

Resubmit with the simplest approach that works.
