/**
 * Cross-platform clipboard utility.
 *
 * Writes text to the system clipboard. Returns `{ ok: true, tool }` on success
 * or `{ ok: false, error }` when no clipboard tool is available or all attempts
 * failed.
 *
 * Platform support:
 * - macOS:   pbcopy
 * - Windows: clip.exe
 * - WSL:     clip.exe (forwards to the Windows host clipboard)
 * - Linux:   wl-copy (Wayland) → xclip → xsel (first that exists wins)
 */

import { spawn } from "node:child_process";
import os from "node:os";

import { isWSL } from "./browser";

export interface ClipboardResult {
  ok: boolean;
  /** Tool name used for the successful write (e.g. "pbcopy", "clip.exe"). */
  tool?: string;
  error?: string;
}

function pipeToCommand(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      proc.on("error", () => resolve(false));
      proc.on("exit", (code) => resolve(code === 0));
      proc.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  const platform = os.platform();

  if (platform === "darwin") {
    const ok = await pipeToCommand("pbcopy", [], text);
    return ok
      ? { ok: true, tool: "pbcopy" }
      : { ok: false, error: "pbcopy failed" };
  }

  if (platform === "win32") {
    const ok = await pipeToCommand("clip.exe", [], text);
    return ok
      ? { ok: true, tool: "clip.exe" }
      : { ok: false, error: "clip.exe failed" };
  }

  if (platform === "linux") {
    if (await isWSL()) {
      const ok = await pipeToCommand("clip.exe", [], text);
      if (ok) return { ok: true, tool: "clip.exe" };
    }

    const candidates: { cmd: string; args: string[] }[] = [
      { cmd: "wl-copy", args: [] },
      { cmd: "xclip", args: ["-selection", "clipboard"] },
      { cmd: "xsel", args: ["--clipboard", "--input"] },
    ];

    for (const { cmd, args } of candidates) {
      const ok = await pipeToCommand(cmd, args, text);
      if (ok) return { ok: true, tool: cmd };
    }

    return {
      ok: false,
      error: "No clipboard tool found. Install wl-copy, xclip, or xsel.",
    };
  }

  return { ok: false, error: `Unsupported platform: ${platform}` };
}
