/**
 * Selection-accuracy characterization matrix.
 *
 * This is NOT a test that enforces desired behavior. It's a
 * characterization of what the CURRENT `findTextInDOM` matcher in
 * `useAnnotationHighlighter.ts` does — producing a
 * pass/fail-per-category count that a future fix effort starts
 * from. Reviewers reading the test output learn exactly which
 * agent-shipped text shapes land on the wrong anchor, which fail
 * entirely, and which work.
 *
 * If you change the matcher, update this test's expectations to
 * describe the NEW behavior. Don't delete failing cases to make
 * it green; the whole point is recording reality.
 *
 * The matcher logic is vendored verbatim from
 * useAnnotationHighlighter.ts:173-236 (findTextInDOM closure).
 * Any drift in the original needs a corresponding update here.
 *
 * See `specs/v1-selection-accuracy.md` for the write-up that
 * explains which rows are bugs, which are acceptable, and the
 * sketch of a fix.
 */

import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import React from 'react';

// Vendored verbatim from useAnnotationHighlighter.ts:173-236.
// Keep in sync if the source closure changes.
function findTextInDOM(container: HTMLElement, searchText: string): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    const index = text.indexOf(searchText);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + searchText.length);
      return range;
    }
  }

  // Try across multiple text nodes for multi-line content
  const fullText = container.textContent || '';
  const searchIndex = fullText.indexOf(searchText);
  if (searchIndex === -1) return null;

  const walker2 = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  let charCount = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while ((node = walker2.nextNode() as Text | null)) {
    const nodeLength = node.textContent?.length || 0;

    if (!startNode && charCount + nodeLength > searchIndex) {
      startNode = node;
      startOffset = searchIndex - charCount;
    }

    if (startNode && charCount + nodeLength >= searchIndex + searchText.length) {
      endNode = node;
      endOffset = searchIndex + searchText.length - charCount;
      break;
    }

    charCount += nodeLength;
  }

  if (startNode && endNode) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  return null;
}

interface MatrixCase {
  n: number;
  label: string;
  /** DOM content for the container. Renderer-equivalent markup. */
  dom: React.ReactElement;
  /** What the agent would ship as `originalText`. */
  agentShips: string;
  /**
   * What the CURRENT matcher does:
   *   "found"  — returns a non-null range with text === agentShips
   *   "missed" — returns null (annotation silently drops)
   *
   * Note that "found" does NOT imply "correct" for the agent's
   * intent. A case where the same substring appears multiple times
   * in the block still returns "found" (first occurrence), even
   * though the agent may have meant a different occurrence. Such
   * cases are classified as `found` here but carry an
   * `ambiguous: true` flag so the spec note can single them out.
   */
  currentBehavior: 'found' | 'missed';
  /** True when "found" but on potentially-wrong text without more context. */
  ambiguous?: boolean;
  /** Short commentary for the write-up. */
  note: string;
}

const CASES: MatrixCase[] = [
  {
    n: 1,
    label: 'exact match, plain text',
    dom: <p>The quick brown fox</p>,
    agentShips: 'quick brown fox',
    currentBehavior: 'found',
    note: 'Happy path; indexOf hits.',
  },
  {
    n: 2,
    label: 'trailing whitespace on agent side',
    dom: <p>The quick brown fox</p>,
    agentShips: 'quick brown fox ', // trailing space
    currentBehavior: 'missed',
    note: 'indexOf requires exact match; trailing whitespace not tolerated.',
  },
  {
    n: 3,
    label: 'leading whitespace on agent side',
    dom: <p>The quick brown fox</p>,
    agentShips: ' quick brown fox',
    currentBehavior: 'found',
    note: 'indexOf finds " quick brown fox" starting at the space BETWEEN "The" and "quick" — match succeeds because the DOM happens to contain the leading-space variant as a substring. Brittle: works only when the preceding character is a space; different formatting would flip this to miss.',
  },
  {
    n: 4,
    label: 'extra space between words (agent shipped double-space)',
    dom: <p>The quick brown fox</p>,
    agentShips: 'quick  brown fox', // two spaces
    currentBehavior: 'missed',
    note: 'Whitespace normalization not applied; double-space != single-space.',
  },
  {
    n: 5,
    label: 'tab vs spaces (agent shipped tab)',
    dom: <p>The quick brown fox</p>,
    agentShips: 'quick\tbrown fox',
    currentBehavior: 'missed',
    note: 'Tab treated as literal; no tab→space normalization.',
  },
  {
    n: 6,
    label: 'non-breaking space vs regular space',
    dom: <p>{'The quick\u00A0brown fox'}</p>, // DOM has NBSP
    agentShips: 'quick brown fox', // agent ships regular space
    currentBehavior: 'missed',
    note: 'NBSP (U+00A0) != space (U+0020); agents that copy from rendered HTML may ship one and see the other.',
  },
  {
    n: 7,
    label: 'agent ships **markdown** when DOM renders bolded text',
    dom: (
      <p>
        The <strong>quick</strong> brown fox
      </p>
    ),
    agentShips: 'the **quick** brown fox',
    currentBehavior: 'missed',
    note: 'Rendered DOM has "The quick brown fox"; agent ships markdown source. No markdown-stripping.',
  },
  {
    n: 8,
    label: 'agent ships _italic_ when DOM renders italicized text',
    dom: (
      <p>
        The <em>quick</em> brown fox
      </p>
    ),
    agentShips: 'the _quick_ brown fox',
    currentBehavior: 'missed',
    note: 'Same family as case 7. DOM has no underscores.',
  },
  {
    n: 9,
    label: 'agent ships text spanning two blocks',
    dom: (
      <div>
        <p>first block ends here.</p>
        <p>second block starts there.</p>
      </div>
    ),
    agentShips: 'ends here.\nsecond block starts there.',
    currentBehavior: 'missed',
    note: 'Single-node pass looks at one text node at a time; multi-node pass uses container.textContent which concatenates WITHOUT inserting the newline the agent shipped.',
  },
  {
    n: 10,
    label: 'text appears twice in block; agent wants the second occurrence',
    dom: <p>fox jumps. fox sleeps.</p>,
    agentShips: 'fox',
    currentBehavior: 'found',
    ambiguous: true,
    note: 'Matcher returns the FIRST occurrence. Agent has no way to request the second without shipping more surrounding context. Silent anchor mismatch to the agent\'s intent.',
  },
  {
    n: 11,
    label: 'agent ships the exact whole-block content',
    dom: <p>A complete thought in one paragraph.</p>,
    agentShips: 'A complete thought in one paragraph.',
    currentBehavior: 'found',
    note: 'Block-level targeting is robust. The collab-agent CLI uses this pattern exclusively in V1.',
  },
  {
    n: 12,
    label: 'smart quote (U+201C/U+201D) vs straight quote',
    dom: <p>{'She said \u201Chello\u201D quietly.'}</p>,
    agentShips: '"hello"', // straight ASCII quotes
    currentBehavior: 'missed',
    note: 'Markdown renderers often convert " → U+201C / U+201D. Agents copying from source see straight; DOM has curly.',
  },
];

/**
 * Render the case's DOM and return the container element.
 */
function renderCase(c: MatrixCase): HTMLElement {
  const { container } = render(<div data-testid="root">{c.dom}</div>);
  return container.querySelector('[data-testid="root"]') as HTMLElement;
}

describe('selection-accuracy matrix (findTextInDOM characterization)', () => {
  for (const c of CASES) {
    test(`${String(c.n).padStart(2, '0')}: ${c.label}`, () => {
      const container = renderCase(c);
      const range = findTextInDOM(container, c.agentShips);

      if (c.currentBehavior === 'missed') {
        expect(range).toBeNull();
      } else {
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe(c.agentShips);
      }
    });
  }

  test('summary: category counts', () => {
    const found = CASES.filter(c => c.currentBehavior === 'found');
    const missed = CASES.filter(c => c.currentBehavior === 'missed');
    const ambiguous = CASES.filter(c => c.ambiguous);
    console.log(
      `\n[selection-accuracy matrix] ` +
        `found=${found.length} missed=${missed.length} ambiguous=${ambiguous.length} ` +
        `(of ${CASES.length} cases). ` +
        `"ambiguous" = matcher returns a range but not necessarily on the agent's intended text.`,
    );
    expect(found.length + missed.length).toBe(CASES.length);
  });
});
