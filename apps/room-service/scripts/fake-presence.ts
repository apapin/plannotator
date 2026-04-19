/**
 * Fake-presence visual-test harness.
 *
 * Joins an existing Live Rooms room as N fake participants, each
 * connecting through the real WebSocket + auth-proof path and
 * emitting block-anchored encrypted presence at a configurable
 * cadence. The room service treats them as ordinary peers; an
 * observer's real browser tab sees participant-count bumps, avatar
 * bubbles, moving cursor labels, edge indicators when offscreen,
 * and clean disappearance on Ctrl-C (via the
 * `room.participant.left` broadcast we ship on WebSocket close).
 *
 * Not a load test. Purpose is visual validation of the real room UI
 * with many peers — "does the cluster still look right at 25? 50?"
 *
 * Usage:
 *   bun run room:fake-presence -- \
 *     --url "http://localhost:8787/c/<roomId>#key=..." \
 *     --users 25 \
 *     --blocks-file tmp/block-ids.txt
 *
 * Optional:
 *   --hz <N>            update rate per user (default 10)
 *   --blocks a,b,c      inline comma-separated block ids
 *   --duration <sec>    auto-stop after N seconds (default: run until Ctrl-C)
 *
 * The most convenient way to get real block IDs: open the room tab,
 * run in DevTools console:
 *   copy([...document.querySelectorAll('[data-block-id]')]
 *       .map(el => el.dataset.blockId).filter(Boolean).join('\n'))
 * then `pbpaste > tmp/block-ids.txt` and pass --blocks-file.
 */

import {
  parseRoomUrl,
  deriveRoomKeys,
  computeRoomVerifier,
  computeAuthProof,
  encryptPresence,
  generateOpId,
} from '@plannotator/shared/collab/client';

import type {
  AuthChallenge,
  PresenceState,
} from '@plannotator/shared/collab';

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface Args {
  url: string;
  users: number;
  hz: number;
  blocks: string[];
  durationSec: number | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i++;
    }
  }

  if (!args.url) {
    fail('Missing --url. Pass the full room URL including the #key=... fragment.');
  }

  const users = Math.max(1, Math.min(500, Number(args.users ?? '10') | 0));
  const hz = Math.max(1, Math.min(60, Number(args.hz ?? '10') | 0));
  const durationSec = args.duration ? Math.max(1, Number(args.duration) | 0) : null;

  let blocks: string[] = [];
  if (args['blocks-file']) {
    try {
      blocks = readFileSync(args['blocks-file'], 'utf8')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
    } catch (e) {
      fail(`Failed to read --blocks-file: ${String(e)}`);
    }
  } else if (args.blocks) {
    blocks = args.blocks.split(',').map(s => s.trim()).filter(Boolean);
  }

  if (blocks.length === 0) {
    console.warn(
      '\n⚠  No --blocks / --blocks-file provided. Using placeholder block ids\n' +
      '   (block-0 through block-9). If the real plan does not render those\n' +
      '   ids, fake cursors will be invisible until you pass real ones.\n' +
      '   Extract block ids from the room tab:\n' +
      '     copy([...document.querySelectorAll(\'[data-block-id]\')]\n' +
      '         .map(el => el.dataset.blockId).filter(Boolean).join(\'\\n\'))\n',
    );
    blocks = Array.from({ length: 10 }, (_, i) => `block-${i}`);
  }

  return { url: args.url, users, hz, blocks, durationSec };
}

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Visual variety
// ---------------------------------------------------------------------------

// Match the UI's swatch palette so fakes look like real participants.
// Duplicated here rather than imported from packages/ui to keep the
// script free of DOM-bound transitive deps.
const SWATCHES = [
  '#2563eb', '#f97316', '#10b981', '#ef4444',
  '#8b5cf6', '#eab308', '#06b6d4', '#ec4899',
] as const;

const NAMES = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
  'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
  'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo',
  'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray',
  'Yankee', 'Zulu',
] as const;

function pickName(i: number): string {
  const base = NAMES[i % NAMES.length];
  const suffix = i < NAMES.length ? '' : ` ${Math.floor(i / NAMES.length) + 1}`;
  return `${base}${suffix}`;
}

function pickColor(i: number): string {
  return SWATCHES[i % SWATCHES.length];
}

// ---------------------------------------------------------------------------
// Fake user
// ---------------------------------------------------------------------------

/**
 * Movement state per fake user. Models reading behavior: each bot
 * cycles between a READING state (mostly still at one point, with
 * tiny jitter like a resting hand on the mouse) and a MOVING state
 * (a short eased traversal to a new point). Pauses are long relative
 * to moves, matching how a person actually reads a document.
 *
 * Previous iteration used continuous sine waves on every axis, which
 * read as a metronome — cursors orbiting the block in predictable
 * loops. The state-machine model with discrete pauses + discrete
 * moves looks meaningfully more human.
 *
 * Per-bot `ampX`/`ampY` scale the target-picking range so different
 * bots reach different corners of the wander area. Permanent
 * `homeX`/`homeY` for each bot — randomized at init across the
 * whole wander width — keeps the crowd horizontally spread instead
 * of collapsing into a vertical column.
 */
interface UserState {
  id: string;
  name: string;
  color: string;
  blockIdx: number;
  /**
   * Continuous-easing model: the bot's rendered position always
   * lerps toward `targetX`/`targetY` at `lerpRate` per tick. Target
   * updates periodically (every few seconds for drifts, shorter
   * for reaches); because the lerp never pauses, there are no
   * segment boundaries with zero velocity — the cursor keeps
   * moving even when a new target is chosen mid-approach.
   *
   * Compared to discrete-segment models, this reads as smoother.
   * Segments with cubic ease-in-out have velocity=0 at each end,
   * which in a 10Hz stream the receiver can perceive as a micro-
   * pulse at every boundary. Continuous lerp has no such boundary.
   *
   * `homeX`/`homeY` is a permanent per-bot home base, randomized
   * at init across the full wander width — keeps the crowd
   * horizontally spread instead of collapsing to a vertical
   * column. Targets are picked relative to the home base, not to
   * the previous target; picking relative to previous random-walks
   * slowly and leaves a bot orbiting its start point.
   */
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** ms at which we should pick a new target (may be passed while still approaching current one). */
  nextTargetAt: number;
  /** Per-bot lerp rate; drifts use a small rate (slow approach), reaches a larger rate (faster). */
  lerpRate: number;
  homeX: number;
  homeY: number;
  ampX: number;
  ampY: number;
  /** When set and > now, emit cursor:null to simulate idle/away. */
  idleUntil: number;
}

// Uniform across the top ~25% of the plan — enough top-skew to
// keep the action near the start of the document, while spreading
// bots evenly across every block in that window instead of piling
// them at blockIdx 0.
function pickStartingBlockIdx(blocksLength: number): number {
  const range = Math.max(1, Math.floor(blocksLength * 0.25));
  return Math.floor(Math.random() * range);
}

// Strong upward bias: soft ceiling at 20% of length. Inside the
// ceiling, steps barely favor forward; past the ceiling, bots lean
// very hard back toward the top so stragglers don't accumulate
// mid-document.
function pickTransitionStep(currentIdx: number, blocksLength: number): number {
  const ceiling = Math.max(5, Math.floor(blocksLength * 0.2));
  const forwardBias = currentIdx < ceiling ? 0.4 : 0.05;
  const magnitude = Math.random() < 0.2 ? 2 : 1;
  const direction = Math.random() < forwardBias ? 1 : -1;
  return magnitude * direction;
}

interface FakeClient {
  state: UserState;
  ws: WebSocket;
  authed: boolean;
  clientId: string | null;
  sends: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function nextCursor(
  state: UserState,
  blocks: string[],
  tNowMs: number,
): PresenceState['cursor'] {
  // Idle simulation: cursor:null for a few seconds.
  if (tNowMs < state.idleUntil) return null;
  if (Math.random() < 0.0002) {
    state.idleUntil = tNowMs + 3000 + Math.random() * 5000;
    return null;
  }

  // Time to pick a new target? (May happen mid-approach — that's
  // fine, the cursor just re-aims and keeps easing. Continuous
  // motion with occasional re-targeting reads smoother than discrete
  // segments that zero-velocity at each boundary.)
  if (tNowMs >= state.nextTargetAt) {
    const doReach = Math.random() < 0.35;
    if (doReach) {
      // Reach: wider radius, faster approach, sometimes crosses
      // into a neighbouring block.
      if (Math.random() < 0.3) {
        const step = pickTransitionStep(state.blockIdx, blocks.length);
        state.blockIdx = (state.blockIdx + step + blocks.length) % blocks.length;
      }
      state.targetX = state.homeX + (Math.random() - 0.5) * 280 * state.ampX;
      state.targetY = state.homeY + (Math.random() - 0.5) * 140 * state.ampY;
      state.lerpRate = 0.16 + Math.random() * 0.06;  // 0.16–0.22, fast
      state.nextTargetAt = tNowMs + 900 + Math.random() * 1100;
    } else {
      // Drift: medium-radius target, moderate approach. Picked
      // relative to the PERMANENT home base so drifts can land
      // anywhere across the wander area instead of random-walking
      // near the previous position.
      state.targetX = state.homeX + (Math.random() - 0.5) * 180 * state.ampX;
      state.targetY = state.homeY + (Math.random() - 0.5) * 90 * state.ampY;
      state.lerpRate = 0.07 + Math.random() * 0.04;  // 0.07–0.11
      state.nextTargetAt = tNowMs + 1500 + Math.random() * 1800;
    }
  }

  // Continuous ease toward current target. Each tick moves by a
  // fraction of the remaining distance — produces a smooth
  // exponential-decay approach with no velocity pulse at target
  // changes. Receiver's own lerp (α=0.3) composes on top.
  state.x += (state.targetX - state.x) * state.lerpRate;
  state.y += (state.targetY - state.y) * state.lerpRate;

  return {
    coordinateSpace: 'block',
    blockId: blocks[state.blockIdx],
    x: state.x,
    y: state.y,
  };
}

// ---------------------------------------------------------------------------
// WebSocket connect + auth
// ---------------------------------------------------------------------------

async function connectAndAuth(
  wsBase: string,
  roomId: string,
  roomVerifier: string,
  state: UserState,
): Promise<FakeClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws/${roomId}`);
    const client: FakeClient = {
      state,
      ws,
      authed: false,
      clientId: null,
      sends: 0,
      errors: 0,
    };

    const timeout = setTimeout(() => {
      if (!client.authed) {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`auth timeout for ${state.name}`));
      }
    }, 10_000);

    ws.onmessage = async (event) => {
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (!client.authed && msg.type === 'auth.challenge') {
        const challenge = msg as unknown as AuthChallenge;
        const proof = await computeAuthProof(
          roomVerifier,
          roomId,
          challenge.clientId,
          challenge.challengeId,
          challenge.nonce,
        );
        client.clientId = challenge.clientId;
        ws.send(JSON.stringify({
          type: 'auth.response',
          challengeId: challenge.challengeId,
          clientId: challenge.clientId,
          proof,
        }));
        return;
      }

      if (!client.authed && msg.type === 'auth.accepted') {
        client.authed = true;
        clearTimeout(timeout);
        // Discard all subsequent inbound — fakes don't need to
        // decrypt peer traffic, just emit their own presence.
        ws.onmessage = () => {};
        resolve(client);
        return;
      }
    };

    ws.onerror = () => {
      if (!client.authed) {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error during auth for ${state.name}`));
      } else {
        client.errors++;
      }
    };
    ws.onclose = () => {
      // If we close before authenticating, surface as reject.
      if (!client.authed) {
        clearTimeout(timeout);
        reject(new Error(`socket closed before auth for ${state.name}`));
      }
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseRoomUrl(args.url);
  if (!parsed) fail('Could not parse --url. Expected .../c/<roomId>#key=<roomSecret>');

  const { roomId, roomSecret } = parsed;
  const origin = new URL(args.url).origin;
  const wsBase = origin.replace(/^http/, 'ws');

  const { authKey, presenceKey } = await deriveRoomKeys(roomSecret);
  const roomVerifier = await computeRoomVerifier(authKey, roomId);

  console.log(
    `\nFake presence:\n` +
    `  origin   ${origin}\n` +
    `  roomId   ${roomId}\n` +
    `  users    ${args.users}\n` +
    `  hz       ${args.hz}\n` +
    `  blocks   ${args.blocks.length}\n` +
    `  duration ${args.durationSec ? `${args.durationSec}s` : 'until Ctrl-C'}\n`,
  );

  // Connect all fakes. Stagger slightly so the server doesn't get a
  // thundering-herd of auth handshakes on the same tick.
  const clients: FakeClient[] = [];
  const connectPromises: Promise<FakeClient>[] = [];
  for (let i = 0; i < args.users; i++) {
    // Permanent home base randomized across the whole wander area,
    // so the crowd is spread horizontally rather than clustering
    // in a narrow start band.
    const ampX = 0.7 + Math.random() * 0.7;
    const ampY = 0.7 + Math.random() * 0.7;
    const homeX = 160 + (Math.random() - 0.5) * 280;
    const homeY = 35 + (Math.random() - 0.5) * 100;

    // Initial position: near home base with some offset so bots
    // don't all start at identical coords.
    const startX = homeX + (Math.random() - 0.5) * 100;
    const startY = homeY + (Math.random() - 0.5) * 50;

    const state: UserState = {
      id: `fake-${i}-${Date.now().toString(36)}`,
      name: pickName(i),
      color: pickColor(i),
      blockIdx: pickStartingBlockIdx(Math.max(1, args.blocks.length)),
      x: startX,
      y: startY,
      targetX: homeX + (Math.random() - 0.5) * 180 * ampX,
      targetY: homeY + (Math.random() - 0.5) * 90 * ampY,
      // Staggered first target so bots don't all re-target on the
      // same tick — without this, the whole crowd would seek a new
      // destination in unison every couple of seconds.
      nextTargetAt: Date.now() + Math.random() * 3000,
      lerpRate: 0.07 + Math.random() * 0.04,  // begin in drift mode
      homeX,
      homeY,
      ampX,
      ampY,
      idleUntil: 0,
    };
    await new Promise(r => setTimeout(r, 30));  // 30ms stagger
    connectPromises.push(
      connectAndAuth(wsBase, roomId, roomVerifier, state)
        .then(c => { clients.push(c); return c; })
        .catch(err => {
          console.error(`  [${state.name}] connect failed: ${err.message}`);
          return null as unknown as FakeClient;
        }),
    );
  }
  await Promise.all(connectPromises);

  const connected = clients.length;
  if (connected === 0) {
    fail('No fake clients authenticated. Check the URL and that the room service is running.');
  }
  console.log(`  connected ${connected}/${args.users}\n`);

  // Presence send loop. One interval per-user to stagger naturally —
  // single global interval would fire all N sends on the same tick,
  // wasting throughput and making the wire look synthetic.
  const intervalMs = Math.round(1000 / args.hz);
  const sendTimers: ReturnType<typeof setInterval>[] = [];
  for (const client of clients) {
    const jitter = Math.random() * intervalMs;
    setTimeout(() => {
      const t = setInterval(async () => {
        if (!client.authed || client.ws.readyState !== 1 /* OPEN */) return;
        try {
          const cursor = nextCursor(client.state, args.blocks, Date.now());
          const presence: PresenceState = {
            user: {
              id: client.state.id,
              name: client.state.name,
              color: client.state.color,
            },
            cursor,
          };
          const ciphertext = await encryptPresence(presenceKey, presence);
          client.ws.send(JSON.stringify({
            clientId: client.clientId,
            opId: generateOpId(),
            channel: 'presence',
            ciphertext,
          }));
          client.sends++;
        } catch (err) {
          client.errors++;
          if (client.errors <= 3) {
            console.error(`  [${client.state.name}] send error: ${String(err)}`);
          }
        }
      }, intervalMs);
      sendTimers.push(t);
    }, jitter);
  }

  // Stats every second.
  const startAt = Date.now();
  let lastSends = 0;
  const statsTimer = setInterval(() => {
    const totalSends = clients.reduce((n, c) => n + c.sends, 0);
    const totalErrors = clients.reduce((n, c) => n + c.errors, 0);
    const alive = clients.filter(c => c.ws.readyState === 1).length;
    const deltaSends = totalSends - lastSends;
    lastSends = totalSends;
    process.stdout.write(
      `\r  alive ${alive}/${connected}  sends/s ${deltaSends}  errors ${totalErrors}   `,
    );
  }, 1000);

  // Graceful shutdown.
  const shutdown = () => {
    process.stdout.write('\n\nShutting down fake participants…\n');
    clearInterval(statsTimer);
    for (const t of sendTimers) clearInterval(t);
    for (const c of clients) {
      try { c.ws.close(); } catch { /* ignore */ }
    }
    // Give the server a beat to fan out the `room.participant.left`
    // broadcasts the real observer tab relies on for clean bubble
    // removal — without this, we'd exit before sendmsg completes for
    // the close frames.
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (args.durationSec) {
    setTimeout(shutdown, args.durationSec * 1000);
  }

  // Keep the event loop alive — setInterval already does this, but
  // belt-and-braces for platforms where timers alone don't hold the
  // process open.
  setInterval(() => {}, 1 << 30);
}

main().catch(err => {
  console.error(`\nFatal: ${String(err)}`);
  process.exit(1);
});
