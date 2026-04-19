# Selection Accuracy — External Annotation Text Matching

## Status

Investigation note. Not a plan; no implementation implied.

## Scope

`/api/external-annotations` accepts annotations from external
tools (agents, CLIs, CI) and anchors each one onto rendered plan
text by calling `findTextInDOM(originalText)` inside
`packages/ui/hooks/useAnnotationHighlighter.ts:173-236`. The
matcher is strict — case-sensitive `indexOf` on the walker's
text nodes, falling back to a concatenated `container.textContent`
pass that ignores inter-node gaps. When the agent's
`originalText` isn't a literal substring of the rendered DOM, the
annotation silently drops.

The Slice 6a agent direct-client CLI (`apps/collab-agent/`) uses
**block-level** targeting for comments — it ships
`originalText = block.content` so this class of drift can't
bite. Agents that continue to use the `/api/external-annotations`
path for inline text targeting ARE exposed to the drift; the
characterization below says which shapes miss, which find, and
which find-but-possibly-wrong-anchor.

The fix itself is out of scope for Slice 6a. This note exists
so the next pass starts with measurements, not a rumor.

## Characterization matrix

Source: `packages/ui/hooks/useAnnotationHighlighter.matrix.test.tsx`.
Run:

```
bun test --cwd packages/ui hooks/useAnnotationHighlighter.matrix.test.tsx
```

Current counts: **found 4 / missed 8 / ambiguous 1** across 12
scenarios.

| # | Case | Behavior | Notes |
|--:|---|---|---|
| 1 | Exact match, plain text | found | Happy path |
| 2 | Trailing whitespace on agent side | **missed** | indexOf requires exact match |
| 3 | Leading whitespace on agent side | found | Only because the preceding DOM char is a space; brittle |
| 4 | Extra space between words | **missed** | No whitespace normalization |
| 5 | Tab vs spaces | **missed** | No whitespace normalization |
| 6 | Non-breaking space (U+00A0) vs regular space | **missed** | NBSP ≠ space; DOM may have either |
| 7 | Agent ships `**bold**` markdown; DOM renders bolded text | **missed** | No markdown stripping |
| 8 | Agent ships `_italic_` markdown; DOM renders italicized text | **missed** | Same family as 7 |
| 9 | Text spans two blocks | **missed** | Fallback concat pass drops inter-block newlines |
| 10 | Text appears twice in block; agent wants 2nd occurrence | found, **ambiguous** | Returns first match; agent can't disambiguate |
| 11 | Agent ships exact whole-block content | found | Block-level target; collab-agent CLI always uses this |
| 12 | Smart quote (U+201C/U+201D) vs straight quote | **missed** | Markdown renderers promote straight → curly |

## What the failures mean in practice

The 8 misses fall into three recurring bug categories:

1. **Whitespace / character drift** (cases 2, 4, 5, 6). Agents
   that construct `originalText` from a different source than
   the rendered DOM (copy from source markdown, from an LLM
   completion with uneven whitespace, from a clipboard that
   introduced an NBSP) get silent drops. Fix candidates: strip
   agent-shipped text of leading/trailing whitespace, collapse
   runs of whitespace to single space, normalize NBSP → space,
   then match against the same-normalized DOM text.

2. **Markdown drift** (cases 7, 8, 12). Agents reading the plan
   in source form carry syntax (`**`, `_`, ASCII quotes) that
   doesn't appear in the rendered DOM. Fix candidates: either
   strip markdown syntax from agent-shipped text before
   matching, or have the agent-facing docs require the agent
   to ship rendered text (and provide a utility).
   Selection-accuracy fix should probably do both.

3. **Block-boundary spans** (case 9). Fallback concat pass
   treats `container.textContent` as one string but joins text
   nodes with nothing, so an agent shipping
   `"first ends here.\nsecond begins."` won't match because the
   DOM concat is `"first ends here.second begins."`. Fix
   candidates: either insert `\n` between text nodes before
   matching, or expose per-block targeting via
   `{ blockId, offset, length }` and deprecate cross-block
   `originalText` entirely.

Ambiguous case 10 is its own thing: the matcher is behaving
correctly (first occurrence is a reasonable default), but agents
have no way to express "I mean the SECOND occurrence" without
shipping more surrounding context. Fix candidates: honor a
separate `context: { before: string; after: string }` field that
narrows the search window, or require agents to ship enough
surrounding text that the target is unique.

## Candidate fix site

`packages/ui/hooks/useAnnotationHighlighter.ts:173-236`
(`findTextInDOM` closure). Any normalization pass needs to
apply the SAME normalization to both the agent-shipped text and
the walker's text nodes; mismatches in which side gets
normalized recreate the drift in a different shape.

For block-boundary spans: the fallback concat at line 195
(`fullText = container.textContent`) needs to either join text
nodes with an explicit separator that matches the agent's
expectation, or be removed in favor of a per-block search scope.

## Non-goals for any fix

- Do not try to auto-correct arbitrary agent-shipped text. A
  silent "best guess" anchor is worse than a miss — the user
  sees an annotation land somewhere unexpected and blames the
  wrong thing. Prefer missing loudly (with the existing
  `console.warn`) over placing annotations speculatively.
- Do not change the `/api/external-annotations` wire shape. The
  fix belongs in the client-side matcher, not the server-side
  validator.

## Sequencing suggestion

If this becomes a slice:

1. Ship a normalization pre-pass for whitespace / NBSP /
   smart-quote (addresses cases 2, 4, 5, 6, 12 — 5/8 of
   misses).
2. Ship markdown-stripping for `**` / `__` / `*` / `_` / `` ` ``
   delimiters (addresses 7, 8 — 2/8 more).
3. Ship block-boundary joining in the concat fallback
   (addresses 9 — last of 8).
4. Separately, decide the ambiguity story (case 10) — needs
   product input on whether a `context` field is worth the API
   surface area.

Each step should re-run the matrix and confirm the `missed`
count drops. The test file records the new classification so
regressions become visible.
