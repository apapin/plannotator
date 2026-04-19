/**
 * `read-annotations` subcommand — connect, print the current
 * annotations list as JSON, disconnect. Each annotation is printed
 * as the raw RoomAnnotation shape from the protocol; consumers map
 * fields themselves.
 */

import { awaitInitialSnapshot, openAgentSession, parseCommonArgs } from './_lib';

export async function runReadAnnotations(argv: readonly string[]): Promise<number> {
  const args = parseCommonArgs(argv);

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

  const state = client.getState();
  process.stdout.write(JSON.stringify(state.annotations, null, 2));
  process.stdout.write('\n');

  client.disconnect('read_done');
  await new Promise<void>((r) => setTimeout(r, 100));
  return 0;
}
