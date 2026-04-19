/**
 * Regression tests for the Pi plan server's approve/deny path:
 *
 *   - saveFinalSnapshot / saveAnnotations throwing must NOT strand the
 *     decision promise (claim-then-publish hardening, H9/R1).
 *   - body.permissionMode must be validated via isValidPermissionMode().
 *
 * Mirrors the fixes in packages/server/index.ts (Bun). The Pi server is
 * the easier integration target because it uses node:http and its
 * `startPlanReviewServer` exposes a straightforward decision promise.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlanReviewServer } from "./server/serverPlan";

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalPort = process.env.PLANNOTATOR_PORT;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve test port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPort === undefined) delete process.env.PLANNOTATOR_PORT;
  else process.env.PLANNOTATOR_PORT = originalPort;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function bootPlanServer(options: { permissionMode?: string } = {}) {
  const homeDir = makeTempDir("plannotator-pi-plan-home-");
  process.env.HOME = homeDir;
  process.chdir(homeDir);  // Avoid picking up repo git context
  process.env.PLANNOTATOR_PORT = String(await reservePort());
  const server = await startPlanReviewServer({
    plan: "# Plan\n\nBody.",
    htmlContent: "<!doctype html><html><body>plan</body></html>",
    origin: "pi",
    permissionMode: options.permissionMode ?? "default",
    sharingEnabled: false,
  });
  return server;
}

describe("pi plan server: decision-hang regression", () => {
  test("approve with a customPath that forces save to throw still resolves the decision", async () => {
    const server = await bootPlanServer();
    try {
      // Force saveFinalSnapshot/saveAnnotations to throw by pointing the
      // custom plan dir at a regular file — mkdirSync recursive will
      // fail with ENOTDIR because an ancestor is a file, not a dir.
      const fileAsDir = join(makeTempDir("plannotator-block-"), "not-a-dir");
      writeFileSync(fileAsDir, "blocker", "utf-8");

      const res = await fetch(`${server.url}/api/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "ok",
          planSave: { enabled: true, customPath: fileAsDir },
        }),
      });
      expect(res.status).toBe(200);

      // Decision promise must resolve even though the save threw.
      const decision = await server.waitForDecision();
      expect(decision.approved).toBe(true);
      expect(decision.savedPath).toBeUndefined();
    } finally {
      server.stop();
    }
  }, 10_000);

  test("deny with a customPath that forces save to throw still resolves the decision", async () => {
    const server = await bootPlanServer();
    try {
      const fileAsDir = join(makeTempDir("plannotator-block-"), "not-a-dir");
      writeFileSync(fileAsDir, "blocker", "utf-8");

      const res = await fetch(`${server.url}/api/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "nope",
          planSave: { enabled: true, customPath: fileAsDir },
        }),
      });
      expect(res.status).toBe(200);

      const decision = await server.waitForDecision();
      expect(decision.approved).toBe(false);
      expect(decision.savedPath).toBeUndefined();
      expect(decision.feedback).toBe("nope");
    } finally {
      server.stop();
    }
  }, 10_000);
});

describe("pi plan server: permissionMode validation", () => {
  test("same-origin body.permissionMode is honored only when isValidPermissionMode passes", async () => {
    const server = await bootPlanServer({ permissionMode: "default" });
    try {
      // Invalid string → silently dropped; fall back to server startup value.
      const res = await fetch(`${server.url}/api/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "ok",
          planSave: { enabled: false },
          permissionMode: "rootKeyPleaseAndThankYou",
        }),
      });
      expect(res.status).toBe(200);
      const decision = await server.waitForDecision();
      expect(decision.permissionMode).toBe("default");
    } finally {
      server.stop();
    }
  }, 10_000);

  test("same-origin body.permissionMode='bypassPermissions' IS honored (valid value)", async () => {
    const server = await bootPlanServer({ permissionMode: "default" });
    try {
      const res = await fetch(`${server.url}/api/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "ok",
          planSave: { enabled: false },
          permissionMode: "bypassPermissions",
        }),
      });
      expect(res.status).toBe(200);
      const decision = await server.waitForDecision();
      expect(decision.permissionMode).toBe("bypassPermissions");
    } finally {
      server.stop();
    }
  }, 10_000);

});
