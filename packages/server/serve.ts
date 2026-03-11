/**
 * Shared Bun.serve() wrapper with port-conflict retry logic.
 *
 * Every Plannotator server (plan, review, annotate, checklist) needs the same
 * bootstrap: try a port, retry on EADDRINUSE, give up after N attempts.
 * This module extracts that boilerplate so each server only supplies its fetch handler.
 */

import { isRemoteSession, getServerPort } from "./remote";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;

export interface StartServerOptions {
  /** The request handler — the only thing that varies between servers. */
  fetch: (req: Request) => Response | Promise<Response>;
}

export interface StartServerResult {
  /** The underlying Bun server instance. */
  server: ReturnType<typeof Bun.serve>;
  /** The port the server is listening on. */
  port: number;
  /** Full URL (http://localhost:{port}). */
  url: string;
  /** Whether running in remote/devcontainer mode. */
  isRemote: boolean;
}

/**
 * Start a Bun HTTP server with automatic port-conflict retries.
 *
 * Retries up to 5 times with 500ms delay when the port is in use.
 * Uses the standard Plannotator port logic (random locally, fixed in remote mode).
 */
export async function startServer(
  options: StartServerOptions,
): Promise<StartServerResult> {
  const isRemote = isRemoteSession();
  const configuredPort = getServerPort();

  let server: ReturnType<typeof Bun.serve> | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      server = Bun.serve({
        port: configuredPort,
        fetch: options.fetch,
      });

      break; // Success
    } catch (err: unknown) {
      const isAddressInUse =
        err instanceof Error && err.message.includes("EADDRINUSE");

      if (isAddressInUse && attempt < MAX_RETRIES) {
        await Bun.sleep(RETRY_DELAY_MS);
        continue;
      }

      if (isAddressInUse) {
        const hint = isRemote
          ? " (set PLANNOTATOR_PORT to use different port)"
          : "";
        throw new Error(
          `Port ${configuredPort} in use after ${MAX_RETRIES} retries${hint}`,
        );
      }

      throw err;
    }
  }

  if (!server) {
    throw new Error("Failed to start server");
  }

  return {
    server,
    port: server.port,
    url: `http://localhost:${server.port}`,
    isRemote,
  };
}
