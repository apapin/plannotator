/**
 * URL-to-Markdown conversion.
 *
 * Fetches a URL via Jina Reader (default) or plain fetch + Turndown,
 * returning clean markdown for the annotation pipeline.
 */

import { htmlToMarkdown } from "./html-to-markdown";

export interface UrlToMarkdownOptions {
  /** Whether to use Jina Reader (true) or plain fetch+Turndown (false). */
  useJina: boolean;
}

export interface UrlToMarkdownResult {
  markdown: string;
  source: "jina" | "fetch+turndown";
}

const FETCH_TIMEOUT_MS = 30_000;

/** Skip Jina for local/private URLs — fetch them directly instead. */
function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".local") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Fetch a URL and return its content as markdown.
 *
 * When `useJina` is true, attempts Jina Reader first (returns markdown
 * directly, handles JS-rendered pages). On failure, warns to stderr
 * and falls back to plain fetch + Turndown.
 */
export async function urlToMarkdown(
  url: string,
  options: UrlToMarkdownOptions,
): Promise<UrlToMarkdownResult> {
  if (options.useJina && !isLocalUrl(url)) {
    try {
      const markdown = await fetchViaJina(url);
      return { markdown, source: "jina" };
    } catch (err) {
      process.stderr.write(
        `[plannotator] Warning: Jina Reader failed (${err instanceof Error ? err.message : String(err)}), falling back to direct fetch...\n`,
      );
    }
  }

  const markdown = await fetchViaTurndown(url);
  return { markdown, source: "fetch+turndown" };
}

/** Fetch via Jina Reader — returns markdown directly. */
async function fetchViaJina(url: string): Promise<string> {
  // Strip fragment (never sent to server) and encode for Jina's path-based API
  const cleanUrl = url.split("#")[0];
  const jinaUrl = `https://r.jina.ai/${cleanUrl}`;
  const headers: Record<string, string> = {
    Accept: "text/plain",
  };

  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(jinaUrl, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch raw HTML and convert via Turndown. */
async function fetchViaTurndown(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Plannotator/1.0; +https://plannotator.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(
        `Not an HTML page (content-type: ${contentType})`,
      );
    }
    const html = await res.text();
    return htmlToMarkdown(html);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Timed out fetching ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
