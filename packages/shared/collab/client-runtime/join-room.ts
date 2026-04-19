/**
 * joinRoom — factory that parses a room URL, derives keys locally,
 * and constructs a CollabRoomClient ready to connect.
 *
 * Client-side only. The URL fragment is client-private.
 */

import {
  deriveRoomKeys,
  deriveAdminKey,
  computeRoomVerifier,
  computeAdminVerifier,
} from '../crypto';
import { ADMIN_SECRET_LENGTH_BYTES } from '../constants';
import { base64urlToBytes } from '../encoding';
import { parseRoomUrl } from '../url';
import { CollabRoomClient } from './client';
import type { JoinRoomOptions } from './types';

export class InvalidRoomUrlError extends Error {
  constructor() { super('Room URL is malformed or missing required fragment'); this.name = 'InvalidRoomUrlError'; }
}

export class InvalidAdminSecretError extends Error {
  constructor(detail: string) {
    super(`Invalid admin secret override: ${detail}`);
    this.name = 'InvalidAdminSecretError';
  }
}

export async function joinRoom(options: JoinRoomOptions): Promise<CollabRoomClient> {
  const parsed = parseRoomUrl(options.url);
  if (!parsed) throw new InvalidRoomUrlError();

  const { roomId, roomSecret } = parsed;
  const adminSecretBytes = resolveAdminSecret(options.adminSecret, parsed.adminSecret);

  const { authKey, eventKey, presenceKey } = await deriveRoomKeys(roomSecret);
  const adminKey = adminSecretBytes ? await deriveAdminKey(adminSecretBytes) : null;
  const roomVerifier = await computeRoomVerifier(authKey, roomId);
  const adminVerifier = adminKey ? await computeAdminVerifier(adminKey, roomId) : null;

  const baseUrl = originFromUrl(options.url);

  const client = new CollabRoomClient({
    roomId,
    baseUrl,
    eventKey,
    presenceKey,
    adminKey,
    roomVerifier,
    adminVerifier,
    user: options.user,
    webSocketImpl: options.webSocketImpl,
    reconnect: options.reconnect,
  });

  if (options.autoConnect) {
    await client.connect();
  }

  return client;
}

function resolveAdminSecret(
  override: Uint8Array | string | undefined,
  fromUrl: Uint8Array | undefined,
): Uint8Array | null {
  // URL-derived admin secrets are length-validated inside parseRoomUrl().
  // Overrides bypass that path, so validate explicitly here.
  if (override instanceof Uint8Array) {
    if (override.length !== ADMIN_SECRET_LENGTH_BYTES) {
      throw new InvalidAdminSecretError(
        `expected ${ADMIN_SECRET_LENGTH_BYTES} bytes, got ${override.length}`,
      );
    }
    return override;
  }
  if (typeof override === 'string') {
    let bytes: Uint8Array;
    try {
      bytes = base64urlToBytes(override);
    } catch (err) {
      throw new InvalidAdminSecretError(`base64url decode failed: ${String(err)}`);
    }
    if (bytes.length !== ADMIN_SECRET_LENGTH_BYTES) {
      throw new InvalidAdminSecretError(
        `expected ${ADMIN_SECRET_LENGTH_BYTES} bytes, got ${bytes.length}`,
      );
    }
    return bytes;
  }
  if (fromUrl) return fromUrl;
  return null;
}

function originFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.origin;
}
