/**
 * `demo` subcommand — walk the plan's heading blocks in order,
 * anchor the agent's cursor to each heading, pause a human-feeling
 * few seconds, and post a block-level comment at each stop.
 *
 * Intended for showcasing "an agent is participating in this room"
 * to an observer watching the browser tab. Not a production agent
 * behavior — real work goes through `comment` with explicit args.
 *
 * Cursor coordinates use `coordinateSpace: 'block'` with the target
 * heading's block id so observers' `RemoteCursorLayer` anchors the
 * cursor to the rendered block rect — robust to viewport size and
 * consistent across peers.
 *
 * Args (in addition to the common --url / --user / --type):
 *   --duration <sec>         total wall time; pauses are scaled so
 *                            the demo fits (default 120)
 *   --comment-template <str> comment body per heading; `{heading}`
 *                            is replaced with the heading's text
 *                            content, `{level}` with the heading
 *                            level number (default:
 *                            "[demo] reviewing {heading}")
 *   --dry-run                move the cursor + heartbeat presence
 *                            but DO NOT post comments
 */

import type { PresenceState, RoomAnnotation } from '@plannotator/shared/collab';
import { parseMarkdownToBlocks } from '@plannotator/ui/utils/parser';
import { startHeartbeat } from '../heartbeat';
import {
  awaitAnnotationEcho,
  awaitInitialSnapshot,
  openAgentSession,
  parseCommonArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  UsageError,
  wireSignalShutdown,
} from './_lib';

const DEFAULT_DURATION_SEC = 120;
const DEFAULT_COMMENT_TEMPLATE = '[demo] reviewing {heading}';
const MIN_PAUSE_MS = 3_000;
const MAX_PAUSE_MS = 6_000;
// Per-heading echo wait. Shorter than the 10s default in the
// comment subcommand because demo is time-boxed; if the server is
// healthy an echo arrives in <100ms, and a full 10s wait on every
// heading would dominate the demo's wall time when something is
// genuinely wrong (e.g. the room is locked).
const DEMO_ECHO_TIMEOUT_MS = 5_000;

export async function runDemo(argv: readonly string[]): Promise<number> {
  const args = parseCommonArgs(argv);
  const durationSec = readNumberFlag(args.rest, 'duration') ?? DEFAULT_DURATION_SEC;
  const template = readStringFlag(args.rest, 'comment-template') ?? DEFAULT_COMMENT_TEMPLATE;
  const dryRun = readBoolFlag(args.rest, 'dry-run');

  if (durationSec <= 0) {
    throw new UsageError(`--duration must be positive; got ${durationSec}`);
  }

  const session = await openAgentSession(args);
  const { client, identity, color } = session;
  const unwireSignals = wireSignalShutdown(client);

  try {
    await awaitInitialSnapshot(client);
  } catch (err) {
    console.error(`[collab-agent] ${(err as Error).message}`);
    client.disconnect('snapshot_timeout');
    unwireSignals();
    return 1;
  }

  const snapshot = client.getState();
  const blocks = parseMarkdownToBlocks(snapshot.planMarkdown);
  const headings = blocks.filter(b => b.type === 'heading');

  if (headings.length === 0) {
    console.error(
      '[collab-agent] demo: no heading blocks in this plan; nothing to walk',
    );
    client.disconnect('no_headings');
    unwireSignals();
    return 1;
  }

  // Distribute the duration across headings. Clamp to a sensible
  // range so a very long duration with one heading doesn't camp
  // forever on a single block, and a very short duration with many
  // headings doesn't turn into a flash-card rotation.
  const perHeadingMs = Math.max(
    MIN_PAUSE_MS,
    Math.min(MAX_PAUSE_MS, Math.floor((durationSec * 1000) / headings.length)),
  );

  await client.sendPresence(session.initialPresence);
  const heartbeat = startHeartbeat(client, session.initialPresence);

  console.log(
    JSON.stringify({
      event: 'demo.start',
      identity,
      headings: headings.length,
      perHeadingMs,
      dryRun,
    }),
  );

  interface CommentFailure {
    blockId: string;
    reason: string;
  }
  const failures: CommentFailure[] = [];

  try {
    for (const heading of headings) {
      // Anchor cursor to the heading block. Observer's
      // RemoteCursorLayer resolves block-space cursors against its
      // own rendered block rect, so the agent's cursor label lands
      // on the heading regardless of the observer's viewport size.
      //
      // x/y are randomized per visit so that multiple agents in
      // the same room don't stack their cursor labels at the same
      // pixel when they both anchor to a heading. Range 20–200 px
      // horizontally covers most block widths without often
      // spilling past the right edge (and RemoteCursorLayer clamps
      // or shows an edge indicator if it does). 0–24 px vertically
      // keeps the cursor near the heading text baseline without
      // wandering into the next block.
      const presence: PresenceState = {
        user: { id: identity, name: identity, color },
        cursor: {
          coordinateSpace: 'block',
          blockId: heading.id,
          x: Math.floor(20 + Math.random() * 180),
          y: Math.floor(Math.random() * 24),
        },
      };
      heartbeat.update(presence);
      await client.sendPresence(presence);

      console.log(
        JSON.stringify({
          event: 'demo.visit',
          blockId: heading.id,
          level: heading.level ?? 0,
          content: heading.content,
        }),
      );

      // Natural pause before posting. Observer has time to notice
      // the cursor move, then the comment appears at the end of
      // the pause window plus the echo round-trip (typically tens
      // of ms on a healthy server).
      await new Promise<void>(r => setTimeout(r, perHeadingMs));

      if (!dryRun) {
        const annotationId = `ann-agent-${crypto.randomUUID()}`;
        const body = template
          .replace('{heading}', heading.content)
          .replace('{level}', String(heading.level ?? 0));
        const annotation: RoomAnnotation = {
          id: annotationId,
          blockId: heading.id,
          startOffset: 0,
          endOffset: heading.content.length,
          type: 'COMMENT',
          text: body,
          originalText: heading.content,
          createdA: Date.now(),
          author: identity,
        };

        // Subscribe before sending; await echo. Confirming per
        // heading means demo's exit code reflects whether every
        // comment actually posted, not just "we sent the bytes".
        // A locked room, disconnect, or server-side rejection
        // arrives as a rejection here — we record the failure,
        // log it, and keep walking so the observer still sees
        // the tour complete. Final exit code reflects whether
        // ANY comment failed.
        const echo = awaitAnnotationEcho(client, annotationId, DEMO_ECHO_TIMEOUT_MS);
        try {
          await client.sendAnnotationAdd([annotation]);
          await echo;
          console.log(
            JSON.stringify({ event: 'demo.comment', blockId: heading.id, annotationId }),
          );
        } catch (err) {
          const reason = (err as Error).message;
          failures.push({ blockId: heading.id, reason });
          console.error(
            JSON.stringify({ event: 'demo.comment.failed', blockId: heading.id, reason }),
          );
        }
      }
    }
  } catch (err) {
    console.error(`[collab-agent] demo error: ${(err as Error).message}`);
    heartbeat.stop();
    client.disconnect('demo_error');
    unwireSignals();
    return 1;
  }

  // Gentle grace period so the final comment has time to echo
  // before we tear the socket down. The heartbeat keeps the agent
  // visible during this window.
  await new Promise<void>(r => setTimeout(r, 1_500));

  heartbeat.stop();
  client.disconnect('demo_done');
  unwireSignals();
  await new Promise<void>(r => setTimeout(r, 100));

  console.log(
    JSON.stringify({
      event: 'demo.end',
      headings: headings.length,
      failed: failures.length,
      failures,
    }),
  );
  // Non-zero exit when any comment failed to echo, so an invoking
  // script can distinguish "cursor walk visible but no comments
  // landed" from a clean run.
  return failures.length > 0 ? 1 : 0;
}
