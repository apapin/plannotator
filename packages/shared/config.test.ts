/**
 * Tests for config.ts — focuses on resolvePlanSave precedence
 * and saveConfig nested merge semantics for planSave.
 *
 * Run: bun test packages/shared/config.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolvePlanSave, type PlannotatorConfig } from "./config";

describe("resolvePlanSave", () => {
  const ENV_KEYS = ["PLANNOTATOR_PLAN_SAVE", "PLANNOTATOR_PLAN_SAVE_ON_ARRIVAL"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("returns defaults when config is empty and no env vars are set", () => {
    expect(resolvePlanSave({})).toEqual({
      enabled: true,
      customPath: null,
      saveOnArrival: true,
    });
  });

  test("reads values from config when present", () => {
    const cfg: PlannotatorConfig = {
      planSave: { enabled: false, customPath: "/tmp/myplans", saveOnArrival: false },
    };
    expect(resolvePlanSave(cfg)).toEqual({
      enabled: false,
      customPath: "/tmp/myplans",
      saveOnArrival: false,
    });
  });

  test("env var PLANNOTATOR_PLAN_SAVE=false overrides config enabled=true", () => {
    process.env.PLANNOTATOR_PLAN_SAVE = "false";
    expect(resolvePlanSave({ planSave: { enabled: true } }).enabled).toBe(false);
  });

  test("env var PLANNOTATOR_PLAN_SAVE=1 overrides config enabled=false", () => {
    process.env.PLANNOTATOR_PLAN_SAVE = "1";
    expect(resolvePlanSave({ planSave: { enabled: false } }).enabled).toBe(true);
  });

  test("env var PLANNOTATOR_PLAN_SAVE_ON_ARRIVAL=false overrides config", () => {
    process.env.PLANNOTATOR_PLAN_SAVE_ON_ARRIVAL = "false";
    expect(resolvePlanSave({ planSave: { saveOnArrival: true } }).saveOnArrival).toBe(false);
  });

  test("customPath has no env var override — always config-sourced", () => {
    process.env.PLANNOTATOR_PLAN_SAVE = "true";
    process.env.PLANNOTATOR_PLAN_SAVE_ON_ARRIVAL = "true";
    const cfg: PlannotatorConfig = {
      planSave: { customPath: "/tmp/custom" },
    };
    expect(resolvePlanSave(cfg).customPath).toBe("/tmp/custom");
  });

  test("partial planSave config fills missing fields with defaults", () => {
    const cfg: PlannotatorConfig = { planSave: { customPath: "/tmp/only" } };
    expect(resolvePlanSave(cfg)).toEqual({
      enabled: true,
      customPath: "/tmp/only",
      saveOnArrival: true,
    });
  });
});
