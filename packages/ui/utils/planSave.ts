/**
 * Plan Save Settings Utility
 *
 * Controls automatic plan saving to ~/.plannotator/plans/ (or a custom
 * directory) on both arrival (server startup) and approve/deny.
 *
 * Source of truth is ~/.plannotator/config.json, delivered to the client in
 * the /api/plan response as `serverConfig.planSave`. This utility also
 * transparently migrates legacy browser-cookie settings
 * (`plannotator-save-enabled`, `plannotator-save-path`) the first time a
 * user loads the UI after upgrade: read cookies → POST to /api/config →
 * clear cookies once the server confirms.
 */

import { storage } from './storage';

const STORAGE_KEY_ENABLED = 'plannotator-save-enabled';
const STORAGE_KEY_PATH = 'plannotator-save-path';

export interface PlanSaveSettings {
  enabled: boolean;
  customPath: string | null;
}

export interface ServerPlanSave {
  enabled?: boolean;
  customPath?: string | null;
  saveOnArrival?: boolean;
}

const DEFAULT_SETTINGS: PlanSaveSettings = {
  enabled: true,
  customPath: null,
};

// One-shot guard so concurrent getPlanSaveSettings() calls only fire a single
// migration POST per page load. Cleared in the fetch .finally() so a failed
// migration retries on the next call.
let migrationInFlight = false;

function readLegacyCookies(): PlanSaveSettings | null {
  const cookieEnabled = storage.getItem(STORAGE_KEY_ENABLED);
  const cookiePath = storage.getItem(STORAGE_KEY_PATH);
  if (cookieEnabled === null && cookiePath === null) return null;
  return {
    enabled: cookieEnabled !== 'false',
    customPath: cookiePath || null,
  };
}

function clearLegacyCookies(): void {
  storage.removeItem(STORAGE_KEY_ENABLED);
  storage.removeItem(STORAGE_KEY_PATH);
}

function postPlanSave(settings: PlanSaveSettings): Promise<Response> {
  return fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planSave: settings }),
  });
}

/**
 * Get current plan save settings.
 *
 * Precedence: serverConfig.planSave (source of truth) → legacy cookies
 * (with one-shot migration) → defaults.
 *
 * @param serverPlanSave The `serverConfig.planSave` value from /api/plan.
 *                       Pass undefined when the server response hasn't
 *                       arrived yet; the function will fall back to cookies.
 */
export function getPlanSaveSettings(
  serverPlanSave?: ServerPlanSave,
): PlanSaveSettings {
  // Server config is authoritative whenever it's present
  if (serverPlanSave !== undefined && serverPlanSave !== null) {
    return {
      enabled: serverPlanSave.enabled ?? true,
      customPath: serverPlanSave.customPath ?? null,
    };
  }

  // Legacy cookie fallback + one-shot migration.
  //
  // Accepted trade-off (see plan "one-time discrepancy window"): on the first
  // post-upgrade session for a user with legacy cookies, this function fires
  // the migration POST and clears the cookies — but it returns the migrated
  // value only to *this* caller. Any subsequent caller in the same session
  // that doesn't yet have `serverPlanSave` from /api/plan (App state is not
  // updated by this migration path) will read cookies-gone → serverPlanSave
  // undefined → defaults. For a user who had saves disabled, this means that
  // session's `-approved.md` / `-denied.md` snapshots land in the default
  // `~/.plannotator/plans/` alongside the arrival `{slug}.md` that was also
  // written with defaults before the UI mounted. Three harmless files on
  // disk in the wrong place, one session, then config.json is authoritative
  // forever after. Same blast radius as the arrival-save trade-off already
  // signed off on — not worth the complexity of a module-level cache or
  // parent-state callback plumbing to close a one-shot window.
  const legacy = readLegacyCookies();
  if (legacy !== null) {
    if (!migrationInFlight) {
      migrationInFlight = true;
      postPlanSave(legacy)
        .then((r) => {
          if (r.ok) clearLegacyCookies();
        })
        .catch(() => { /* keep cookies; retry next load */ })
        .finally(() => { migrationInFlight = false; });
    }
    return legacy;
  }

  return DEFAULT_SETTINGS;
}

// Serialize POSTs so rapid changes (e.g. keystrokes in the custom-path input)
// land on the server in call order. Without this, an earlier POST arriving
// after a later one could persist a stale prefix in config.json even though
// the UI shows the final value.
let saveQueue: Promise<unknown> = Promise.resolve();

/**
 * Persist plan save settings.
 *
 * Writes to ~/.plannotator/config.json via POST /api/config. Also clears
 * legacy cookies defensively so a user editing settings post-migration
 * doesn't leave stale cookie values behind. Writes are chained so calls
 * issued in quick succession are processed in order.
 */
export function savePlanSaveSettings(settings: PlanSaveSettings): Promise<void> {
  const next = saveQueue.then(async () => {
    try {
      const res = await postPlanSave(settings);
      if (res.ok) clearLegacyCookies();
    } catch {
      // Silent — Settings UI already reflects the change locally; next load
      // will retry via the cookie fallback path if the POST never landed.
    }
  });
  // Swallow errors on the queue itself so a single failure doesn't break the chain.
  saveQueue = next.catch(() => {});
  return next;
}
