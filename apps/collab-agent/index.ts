/**
 * @plannotator/collab-agent — CLI entry point.
 *
 * Dispatches to a subcommand under `./subcommands/`. Each subcommand
 * is responsible for its own arg parsing, connection lifecycle, and
 * exit code. This file stays small on purpose: argv routing and a
 * help message; no protocol knowledge here.
 *
 * Usage:
 *   bun run apps/collab-agent/index.ts <subcommand> --url <url> --user <name> --type <kind> [...]
 *
 * Subcommands will be filled in across Phases 3, 5, 6. For now this
 * is a skeleton that verifies the package's dependency graph resolves
 * cleanly under Bun — no ConfigStore, no React, no DOM.
 */

import { parseRoomUrl } from '@plannotator/shared/collab/client';
import { parseMarkdownToBlocks } from '@plannotator/ui/utils/parser';
import { hashNameToSwatch, PRESENCE_SWATCHES } from '@plannotator/ui/utils/presenceColor';

// These imports exist to exercise the full declared dependency graph
// at load time. If any of the three utilities above ever start
// importing ConfigStore / React / DOM, Bun will surface the failure
// when this file runs.
void parseRoomUrl;
void parseMarkdownToBlocks;
void hashNameToSwatch;
void PRESENCE_SWATCHES;

const HELP = `plannotator collab-agent — join Live Rooms as an AI agent

Usage:
  bun run apps/collab-agent/index.ts <subcommand> [options]

Subcommands (implemented across subsequent phases):
  join               connect and stay online with heartbeat presence
  read-plan          print the decrypted plan markdown
  read-annotations   print the current annotations as JSON
  read-presence      print recent peer presence (not a roster)
  comment            post a block-level comment annotation
  demo               walk headings and leave comments at each

This is a Phase 1 skeleton. Subcommands not yet wired.
`;

function main(argv: readonly string[]): number {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return 0;
  }
  console.error(`collab-agent: unknown subcommand "${sub}" (not yet implemented)`);
  console.error('Run with --help for the current subcommand list.');
  return 2;
}

process.exit(main(process.argv.slice(2)));
