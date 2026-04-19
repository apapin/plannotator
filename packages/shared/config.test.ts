import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * The config module reads `homedir()` at import time to fix its
 * CONFIG_DIR, so we re-import it in a subprocess per scenario with
 * HOME pointed at a tmp dir — matches the pattern already used in
 * `improvement-hooks.test.ts`. We're only validating that
 * `presenceColor` now rides the same save/load/getServerConfig path
 * as `displayName`; those APIs used to silently drop the field.
 */

const TEST_HOME = join(tmpdir(), `config-test-${Date.now()}`);

afterEach(() => {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

async function runScript(script: string): Promise<string> {
  const proc = Bun.spawn(
    ['bun', '-e', script],
    {
      env: { ...process.env, HOME: TEST_HOME },
      cwd: join(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Subprocess failed (exit ${exit}): ${stderr}`);
  }
  return stdout.trim();
}

describe('config — presenceColor save/load roundtrip', () => {
  test('saveConfig({presenceColor}) persists and loadConfig reads it back', async () => {
    const script = `
      import { saveConfig, loadConfig } from "./packages/shared/config";
      saveConfig({ displayName: "alice", presenceColor: "#10b981" });
      const reloaded = loadConfig();
      console.log(JSON.stringify(reloaded));
    `;
    const out = await runScript(script);
    const cfg = JSON.parse(out);
    expect(cfg.displayName).toBe('alice');
    expect(cfg.presenceColor).toBe('#10b981');
  });

  test('getServerConfig includes presenceColor when set', async () => {
    const script = `
      import { saveConfig, getServerConfig } from "./packages/shared/config";
      saveConfig({ presenceColor: "#f97316" });
      console.log(JSON.stringify(getServerConfig(null)));
    `;
    const out = await runScript(script);
    const sc = JSON.parse(out);
    expect(sc.presenceColor).toBe('#f97316');
  });

  test('getServerConfig omits presenceColor when not set', async () => {
    const script = `
      import { saveConfig, getServerConfig } from "./packages/shared/config";
      // Only displayName written; presenceColor should not appear in
      // the serverConfig payload so clients don't override their
      // local cookie with undefined.
      saveConfig({ displayName: "bob" });
      console.log(JSON.stringify(getServerConfig(null)));
    `;
    const out = await runScript(script);
    const sc = JSON.parse(out);
    expect(sc.displayName).toBe('bob');
    expect('presenceColor' in sc).toBe(false);
  });

  test('partial saveConfig updates only the fields given', async () => {
    const script = `
      import { saveConfig, loadConfig } from "./packages/shared/config";
      saveConfig({ displayName: "carol", presenceColor: "#ec4899" });
      saveConfig({ presenceColor: "#06b6d4" });
      console.log(JSON.stringify(loadConfig()));
    `;
    const out = await runScript(script);
    const cfg = JSON.parse(out);
    expect(cfg.displayName).toBe('carol');
    expect(cfg.presenceColor).toBe('#06b6d4');
  });
});
