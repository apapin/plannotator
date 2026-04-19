#!/usr/bin/env bash
# Local manual E2E runner for Plannotator Live Rooms.
#
# Starts two long-running processes:
#   - apps/room-service via `bun run dev:room` (wrangler dev on :8787).
#   - apps/hook via `bun run dev:hook` (Vite on :3000) with
#     VITE_ROOM_BASE_URL pointing at whichever room service the user
#     wants the editor's `createRoom()` to target.
#
# Default target: http://localhost:8787 (the local wrangler dev above).
# Tunnel / staging: pass ROOM_BASE_URL=<url> — generated participant
# and admin links then carry that URL instead of localhost, so a
# second machine can actually reach the room.
#
#   ROOM_BASE_URL=https://your-tunnel.trycloudflare.com bun run dev:live-room
#
# Traps Ctrl-C / exit and tears down both child processes so a second
# run doesn't collide with orphaned wrangler or Vite instances.
#
# Iteration scope:
#   - Creator tab at :3000 uses Vite HMR — changes to App.tsx land live.
#   - Room tab served by the room service runs the built shell, so
#     changes to RoomApp / collab components need a manual
#     `bun run --cwd apps/room-service build:shell` + browser refresh.
#     Not auto-watched here on purpose.
#
# Bash 3.2 compatible (macOS system Bash). `wait -n` is Bash 4.3+ and
# is NOT available on macOS, so this script polls both child PIDs in
# a loop with `kill -0` instead.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ROOM_BASE_URL="${ROOM_BASE_URL:-http://localhost:8787}"

# Child PIDs populated as services start; cleaned up on signal.
ROOM_PID=""
HOOK_PID=""

cleanup() {
  # `|| true` on each kill so a missing/already-exited child doesn't
  # mask the cleanup of the other.
  if [[ -n "$ROOM_PID" ]]; then
    kill "$ROOM_PID" 2>/dev/null || true
  fi
  if [[ -n "$HOOK_PID" ]]; then
    kill "$HOOK_PID" 2>/dev/null || true
  fi
  # Give children a beat to flush and exit cleanly before returning.
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

printf '\n'
printf 'Plannotator editor: http://localhost:3000\n'
printf 'Room service:       http://localhost:8787  (wrangler dev)\n'
printf 'Editor targets:     %s\n' "$ROOM_BASE_URL"
printf '\n'
printf 'Open the editor, click Start live room.\n'
printf 'The room tab should open at %s/c/...\n' "$ROOM_BASE_URL"
printf 'Copy the participant link into an incognito window or another browser profile.\n'
printf 'Participants do not need to run Plannotator.\n'
printf '\n'
printf 'Ctrl-C to stop both services.\n'
printf '\n'

bun run dev:room &
ROOM_PID=$!

VITE_ROOM_BASE_URL="$ROOM_BASE_URL" bun run dev:hook &
HOOK_PID=$!

# Poll both PIDs; exit if either child dies so a crashed service
# doesn't leave the other orphaned. `wait -n` would do this in one
# line on Bash 4.3+, but macOS ships Bash 3.2 where that flag is
# invalid ("bash: wait: -n: invalid option") — use `kill -0` as a
# liveness probe instead.
while true; do
  if [[ -n "$ROOM_PID" ]] && ! kill -0 "$ROOM_PID" 2>/dev/null; then
    wait "$ROOM_PID" 2>/dev/null || true
    exit 1
  fi
  if [[ -n "$HOOK_PID" ]] && ! kill -0 "$HOOK_PID" 2>/dev/null; then
    wait "$HOOK_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
