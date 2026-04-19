/**
 * `read-presence` subcommand — connect, emit our presence once,
 * wait 2 s for peers to emit, print the remote presence snapshot,
 * disconnect.
 *
 * Output includes a banner clarifying that this is *recent
 * presence*, not a participant roster. The V1 protocol has no
 * roster broadcast; users who are connected but haven't emitted
 * presence within the TTL will not appear. Agents trusting the
 * output as a full roster would get wrong answers.
 */

import { awaitInitialSnapshot, openAgentSession, parseCommonArgs, readNumberFlag } from './_lib';

const DEFAULT_SETTLE_MS = 2_000;

export async function runReadPresence(argv: readonly string[]): Promise<number> {
  const args = parseCommonArgs(argv);
  const settleSec = readNumberFlag(args.rest, 'settle');
  const settleMs = settleSec !== undefined ? Math.max(0, settleSec) * 1000 : DEFAULT_SETTLE_MS;

  const session = await openAgentSession(args);
  const { client } = session;

  try {
    await awaitInitialSnapshot(client);
  } catch (err) {
    console.error(`[collab-agent] ${(err as Error).message}`);
    client.disconnect('snapshot_timeout');
    return 1;
  }

  await client.sendPresence(session.initialPresence);

  // Let inbound presence settle. Observers emit on mouse move, so
  // in an idle room we expect zero inbound — that's the honest
  // answer, not a bug.
  await new Promise<void>((r) => setTimeout(r, settleMs));

  const state = client.getState();
  process.stderr.write(
    '[collab-agent] note: this is RECENT PRESENCE, not a participant roster. ' +
      'Connected-but-idle peers (no cursor move in the last 30s) will NOT appear.\n',
  );
  process.stdout.write(JSON.stringify(state.remotePresence, null, 2));
  process.stdout.write('\n');

  client.disconnect('read_done');
  await new Promise<void>((r) => setTimeout(r, 100));
  return 0;
}
