/**
 * createRoom — HTTP helper that creates a room on room-service and returns
 * a ready-to-connect CollabRoomClient plus the URLs and raw secrets.
 *
 * Client-side only. Runs in browsers, Bun, and direct-agent environments.
 */

import {
  deriveRoomKeys,
  deriveAdminKey,
  computeRoomVerifier,
  computeAdminVerifier,
  encryptSnapshot,
} from '../crypto';
import { generateRoomId, generateRoomSecret, generateAdminSecret } from '../ids';
import { isRoomSnapshot } from '../types';
import { buildRoomJoinUrl, buildAdminRoomUrl } from '../url';
import type { CreateRoomRequest } from '../types';
import { CollabRoomClient, InvalidOutboundPayloadError } from './client';
import type { CreateRoomOptions, CreateRoomResult } from './types';

export class CreateRoomError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'CreateRoomError';
  }
}

export async function createRoom(options: CreateRoomOptions): Promise<CreateRoomResult> {
  // Validate the initial snapshot BEFORE any network/crypto work. A UI bug
  // that passes a malformed snapshot should fail immediately and clearly
  // instead of after a fetch round-trip the server will reject.
  if (!isRoomSnapshot(options.initialSnapshot)) {
    throw new InvalidOutboundPayloadError('Invalid initialSnapshot payload');
  }

  const roomId = generateRoomId();
  const roomSecret = generateRoomSecret();
  const adminSecret = generateAdminSecret();

  const { authKey, eventKey, presenceKey } = await deriveRoomKeys(roomSecret);
  const adminKey = await deriveAdminKey(adminSecret);
  const roomVerifier = await computeRoomVerifier(authKey, roomId);
  const adminVerifier = await computeAdminVerifier(adminKey, roomId);
  const initialSnapshotCiphertext = await encryptSnapshot(eventKey, options.initialSnapshot);

  const body: CreateRoomRequest = {
    roomId,
    roomVerifier,
    adminVerifier,
    initialSnapshotCiphertext,
    expiresInDays: options.expiresInDays,
  };

  const fetchFn = options.fetchImpl ?? fetch;
  // new URL() handles trailing slashes correctly regardless of caller hygiene.
  const apiUrl = new URL('/api/rooms', options.baseUrl).toString();

  // Timeout + external-signal cancellation. Without this, a server hang or
  // a dropped connection would leave createRoom() pending indefinitely, and
  // the caller has no way to bail. Compose the two signals via AbortController
  // so either source aborts the fetch.
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new CreateRoomError(0, 'createRoom timed out')), timeoutMs);
  const externalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId);
      throw new CreateRoomError(0, 'createRoom aborted before start');
    }
    options.signal.addEventListener('abort', externalAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetchFn(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Distinguish timeout / external abort / transport failure for the caller.
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason instanceof CreateRoomError
        ? reason
        : new CreateRoomError(0, `createRoom aborted: ${String(reason ?? err)}`);
    }
    throw new CreateRoomError(0, `createRoom fetch failed: ${String(err)}`);
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', externalAbort);
  }

  if (res.status !== 201) {
    let message = `createRoom failed with status ${res.status}`;
    try {
      const errBody = await res.json() as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch { /* ignore */ }
    throw new CreateRoomError(res.status, message);
  }

  // Success. Do NOT parse the response body — we already have everything
  // needed (roomId, secrets, locally-built URLs, derived keys). Parsing an
  // empty, malformed, or future-format body could strand the user from a
  // room that already exists and whose only admin secret lives in memory.
  // Protocol neatness is less important than not losing recovery material.

  const joinUrl = buildRoomJoinUrl(roomId, roomSecret, options.baseUrl);
  const adminUrl = buildAdminRoomUrl(roomId, roomSecret, adminSecret, options.baseUrl);

  const client = new CollabRoomClient({
    roomId,
    baseUrl: options.baseUrl,
    eventKey,
    presenceKey,
    adminKey,
    roomVerifier,
    adminVerifier,
    user: options.user,
    initialSnapshot: options.initialSnapshot,
    webSocketImpl: options.webSocketImpl,
    reconnect: options.reconnect,
  });

  return { roomId, roomSecret, adminSecret, joinUrl, adminUrl, client };
}
