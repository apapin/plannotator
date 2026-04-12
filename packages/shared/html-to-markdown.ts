/**
 * HTML-to-Markdown conversion via Turndown.
 *
 * Shared between the CLI (single HTML file / URL) and the server
 * (on-demand conversion for HTML files in folder mode).
 */

import TurndownService from "turndown";

/**
 * Build a reusable TurndownService instance configured for Plannotator's
 * markdown parser (atx headings, fenced code blocks, `-` bullet lists)
 * with a manual GFM table rule (avoids the turndown-plugin-gfm dependency).
 */
function createTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // --- GFM table rule (replaces turndown-plugin-gfm tables) ---

  td.addRule("tableCell", {
    filter: ["th", "td"],
    replacement(content, node) {
      return cell(content.trim().replace(/\n/g, " "), node as HTMLElement);
    },
  });

  td.addRule("tableRow", {
    filter: "tr",
    replacement(content, node) {
      let border = "";
      if (isFirstTHeadRow(node as HTMLElement)) {
        const el = node as HTMLElement;
        const cols = el.children;
        for (let i = 0; i < cols.length; i++) {
          border += cell("---", cols[i] as HTMLElement);
        }
      }
      return "\n" + content + (border ? "\n" + border : "");
    },
  });

  td.addRule("table", {
    filter: "table",
    replacement(content) {
      // Trim leading/trailing newlines from the accumulated rows
      return "\n\n" + content.trim() + "\n\n";
    },
  });

  td.addRule("tableSection", {
    filter: ["thead", "tbody", "tfoot"],
    replacement(content) {
      return content;
    },
  });

  // Strip <style> and <script> tags entirely (Turndown keeps unrecognised
  // tags as blank by default, but their text content can leak through).
  td.remove(["style", "script", "noscript"]);

  return td;
}

/** Wrap cell content in pipe-table delimiters. */
function cell(content: string, node: HTMLElement): string {
  const parent = node.parentNode as HTMLElement | null;
  const siblings = parent?.children;
  const idx = siblings ? Array.prototype.indexOf.call(siblings, node) : 0;
  return (idx === 0 ? "| " : " ") + content + " |";
}

/** True if this <tr> is the first row inside a <thead>. */
function isFirstTHeadRow(node: HTMLElement): boolean {
  const parent = node.parentNode as HTMLElement | null;
  return (
    parent?.nodeName === "THEAD" &&
    parent.childNodes[0] === node
  );
}

// Module-level singleton — TurndownService is stateless across calls.
const td = createTurndownService();

/**
 * Convert an HTML string to Markdown.
 *
 * Uses a module-level TurndownService singleton (stateless, safe to reuse).
 * Tables are converted to GFM pipe-table format.
 */
export function htmlToMarkdown(html: string): string {
  return td.turndown(html);
}
