/**
 * `read-plan` subcommand — connect, briefly flash our presence so
 * observers see us, print the decrypted plan markdown, disconnect.
 *
 * With `--with-block-ids`, prefix each block with `[block:<id>]\n`
 * so agents that need to target comments can pair the source
 * markdown with the block ids the browser derives from it. The
 * block parsing is shared with the browser renderer (identical
 * `parseMarkdownToBlocks` call) so ids round-trip.
 */

import { parseMarkdownToBlocks } from '@plannotator/ui/utils/parser';
import {
  awaitInitialSnapshot,
  openAgentSession,
  parseCommonArgs,
  readBoolFlag,
} from './_lib';

export async function runReadPlan(argv: readonly string[]): Promise<number> {
  const args = parseCommonArgs(argv);
  const withBlockIds = readBoolFlag(args.rest, 'with-block-ids');

  const session = await openAgentSession(args);
  const { client } = session;

  try {
    await awaitInitialSnapshot(client);
  } catch (err) {
    console.error(`[collab-agent] ${(err as Error).message}`);
    client.disconnect('snapshot_timeout');
    return 1;
  }

  // Emit presence once so an observer sees the agent flash during
  // the read. We don't heartbeat — the subcommand exits shortly.
  await client.sendPresence(session.initialPresence);

  const state = client.getState();
  if (!withBlockIds) {
    process.stdout.write(state.planMarkdown);
    if (!state.planMarkdown.endsWith('\n')) process.stdout.write('\n');
  } else {
    const blocks = parseMarkdownToBlocks(state.planMarkdown);
    for (const block of blocks) {
      process.stdout.write(`[block:${block.id}] `);
      process.stdout.write(block.content);
      process.stdout.write('\n');
    }
  }

  client.disconnect('read_done');
  // Give the socket a beat to send close frame.
  await new Promise<void>((r) => setTimeout(r, 100));
  return 0;
}
