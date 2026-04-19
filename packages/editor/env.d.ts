/// <reference types="vite/client" />

/**
 * Vite client types for `import.meta.env` access inside the editor
 * package. The hook (apps/hook) bundles this code through Vite and
 * injects VITE_-prefixed env vars at build/dev time; this file is
 * what makes TypeScript accept `import.meta.env.VITE_ROOM_BASE_URL`
 * without a clever cast.
 *
 * Runtime notes:
 *   - `VITE_ROOM_BASE_URL` — local E2E testing only. Set by
 *     `scripts/dev-live-room-local.sh` so the editor at :3000 creates
 *     rooms against the local wrangler dev at :8787 instead of the
 *     production `room.plannotator.ai`. Production builds leave it
 *     undefined and the fallback kicks in.
 */

interface ImportMetaEnv {
  readonly VITE_ROOM_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
