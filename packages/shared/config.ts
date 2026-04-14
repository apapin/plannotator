/**
 * Plannotator Config
 *
 * Reads/writes ~/.plannotator/config.json for persistent user settings.
 * Runtime-agnostic: uses only node:fs, node:os, node:child_process.
 */

import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";

export type DefaultDiffType = 'uncommitted' | 'unstaged' | 'staged';

export interface DiffOptions {
  diffStyle?: 'split' | 'unified';
  overflow?: 'scroll' | 'wrap';
  diffIndicators?: 'bars' | 'classic' | 'none';
  lineDiffType?: 'word-alt' | 'word' | 'char' | 'none';
  showLineNumbers?: boolean;
  showDiffBackground?: boolean;
  fontFamily?: string;
  fontSize?: string;
  defaultDiffType?: DefaultDiffType;
}

/** Single conventional comment label entry stored in config.json */
export interface CCLabelConfig {
  label: string;
  display: string;
  blocking: boolean;
}

/**
 * Plan save preferences. Controls whether plans are written to
 * ~/.plannotator/plans/ (or a custom directory) both on arrival (server
 * startup) and on approve/deny decisions.
 *
 * Migrated from browser cookies (`plannotator-save-enabled`,
 * `plannotator-save-path`) to config.json so the server can honor user
 * preferences during arrival save — before the UI has made any request.
 */
export interface PlanSaveConfig {
  /** Master switch. When false, no decision snapshots are written. Default: true. */
  enabled?: boolean;
  /** Custom directory for plan saves. null/undefined = default ~/.plannotator/plans/. */
  customPath?: string | null;
  /** When true, writes plain {slug}.md on server startup. Default: true. */
  saveOnArrival?: boolean;
}

export interface PlannotatorConfig {
  displayName?: string;
  diffOptions?: DiffOptions;
  conventionalComments?: boolean;
  /** null = explicitly cleared (use defaults), undefined = not set */
  conventionalLabels?: CCLabelConfig[] | null;
  /**
   * Enable `gh attestation verify` during CLI installation/upgrade.
   * Read by scripts/install.sh|ps1|cmd on every run (not by any runtime code).
   * When true, the installer runs build-provenance verification after the
   * SHA256 checksum check; requires `gh` CLI installed and authenticated
   * (`gh auth login`). OS-level opt-in only — no UI surface. Default: false.
   */
  verifyAttestation?: boolean;
  /**
   * Enable Jina Reader for URL-to-markdown conversion during annotation.
   * When true (default), `plannotator annotate <url>` routes through
   * r.jina.ai for better JS-rendered page support and reader-mode extraction.
   * Set to false to always use plain fetch + Turndown.
   */
  jina?: boolean;
  /** Plan save preferences (migrated from browser cookies). */
  planSave?: PlanSaveConfig;
}

const CONFIG_DIR = join(homedir(), ".plannotator");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Load config from ~/.plannotator/config.json.
 * Returns {} on missing file or malformed JSON.
 */
export function loadConfig(): PlannotatorConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (e) {
    process.stderr.write(`[plannotator] Warning: failed to read config.json: ${e}\n`);
    return {};
  }
}

/**
 * Save config by merging partial values into the existing file.
 * Creates ~/.plannotator/ directory if needed.
 */
export function saveConfig(partial: Partial<PlannotatorConfig>): void {
  try {
    const current = loadConfig();
    const mergedDiffOptions = (current.diffOptions || partial.diffOptions)
      ? { ...current.diffOptions, ...partial.diffOptions }
      : undefined;
    const mergedPlanSave = (current.planSave || partial.planSave)
      ? { ...current.planSave, ...partial.planSave }
      : undefined;
    const merged = {
      ...current,
      ...partial,
      diffOptions: mergedDiffOptions,
      planSave: mergedPlanSave,
    };
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  } catch (e) {
    process.stderr.write(`[plannotator] Warning: failed to write config.json: ${e}\n`);
  }
}

/**
 * Detect the git user name from `git config user.name`.
 * Returns null if git is unavailable, not in a repo, or user.name is not set.
 */
export function detectGitUser(): string | null {
  try {
    const name = execSync("git config user.name", { encoding: "utf-8", timeout: 3000 }).trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Build the serverConfig payload for API responses.
 * Reads config.json fresh each call so the response reflects the latest file on disk.
 */
export function getServerConfig(gitUser: string | null): {
  displayName?: string;
  diffOptions?: DiffOptions;
  gitUser?: string;
  conventionalComments?: boolean;
  conventionalLabels?: CCLabelConfig[] | null;
  planSave?: PlanSaveConfig;
} {
  const cfg = loadConfig();
  return {
    displayName: cfg.displayName,
    diffOptions: cfg.diffOptions,
    gitUser: gitUser ?? undefined,
    ...(cfg.conventionalComments !== undefined && { conventionalComments: cfg.conventionalComments }),
    ...(cfg.conventionalLabels !== undefined && { conventionalLabels: cfg.conventionalLabels }),
    ...(cfg.planSave !== undefined && { planSave: cfg.planSave }),
  };
}

/**
 * Read the user's preferred default diff type from config, falling back to 'unstaged'.
 */
export function resolveDefaultDiffType(cfg?: PlannotatorConfig): DefaultDiffType {
  const v = cfg?.diffOptions?.defaultDiffType;
  return v === 'uncommitted' || v === 'unstaged' || v === 'staged' ? v : 'unstaged';
}

/**
 * Resolve whether to use Jina Reader for URL annotation.
 *
 * Priority (highest wins):
 *   --no-jina CLI flag  →  PLANNOTATOR_JINA env var  →  config.jina  →  default true
 */
export function resolveUseJina(cliNoJina: boolean, config: PlannotatorConfig): boolean {
  // CLI flag has highest priority
  if (cliNoJina) return false;

  // Environment variable
  const envVal = process.env.PLANNOTATOR_JINA;
  if (envVal !== undefined) {
    return envVal === "1" || envVal.toLowerCase() === "true";
  }

  // Config file
  if (config.jina !== undefined) return config.jina;

  // Default: enabled
  return true;
}

function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

/**
 * Reject unsafe custom plan-save paths at the `/api/config` boundary.
 *
 * Rejects strings containing `..` path segments — defense-in-depth against a
 * local process POSTing a traversal path that would later be read back via
 * `loadConfig()` and used by the arrival save. The server binds to loopback
 * by default so this is not a remote-reachable sink, but the two-step
 * (write → restart → use) pattern warrants a boundary check.
 *
 * Returns true for `null` (reset to default) and for strings without `..`
 * segments. Non-strings are rejected. Absolute paths and `~` are allowed —
 * users can legitimately pick any directory they have write access to.
 */
export function isSafeCustomPath(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const segments = value.replace(/\\/g, "/").split("/");
  return !segments.some((s) => s === "..");
}

/**
 * Resolve effective plan-save settings from config + environment.
 *
 * Priority (highest wins):
 *   PLANNOTATOR_PLAN_SAVE / PLANNOTATOR_PLAN_SAVE_ON_ARRIVAL env vars
 *     → config.json planSave.{enabled, customPath, saveOnArrival}
 *       → defaults (enabled: true, customPath: null, saveOnArrival: true)
 *
 * customPath has no env var override (paths are too user-specific; config.json
 * is the one source). Session-level overrides happen via the approve/deny
 * request body, handled by the caller.
 */
export function resolvePlanSave(config: PlannotatorConfig): {
  enabled: boolean;
  customPath: string | null;
  saveOnArrival: boolean;
} {
  const envEnabled = parseBoolEnv(process.env.PLANNOTATOR_PLAN_SAVE);
  const envOnArrival = parseBoolEnv(process.env.PLANNOTATOR_PLAN_SAVE_ON_ARRIVAL);
  return {
    enabled: envEnabled ?? config.planSave?.enabled ?? true,
    customPath: config.planSave?.customPath ?? null,
    saveOnArrival: envOnArrival ?? config.planSave?.saveOnArrival ?? true,
  };
}
