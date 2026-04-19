/**
 * Unit tests for joinRoom — focus on admin secret override length validation (P3).
 */

import { describe, expect, test } from 'bun:test';
import { joinRoom, InvalidAdminSecretError, InvalidRoomUrlError } from './join-room';
import { buildRoomJoinUrl } from '../url';
import { generateRoomSecret } from '../ids';
import { bytesToBase64url } from '../encoding';
import type { CollabRoomUser } from './types';

const USER: CollabRoomUser = { id: 'u1', name: 'alice', color: '#f00' };

describe('joinRoom — admin secret override validation (P3)', () => {
  test('rejects Uint8Array admin override with wrong length', async () => {
    const roomSecret = generateRoomSecret();
    const url = buildRoomJoinUrl('roomA', roomSecret);
    const badAdmin = new Uint8Array(16);  // 16 bytes, not 32

    await expect(joinRoom({ url, adminSecret: badAdmin, user: USER }))
      .rejects.toThrow(InvalidAdminSecretError);
  });

  test('rejects string admin override that decodes to wrong length', async () => {
    const roomSecret = generateRoomSecret();
    const url = buildRoomJoinUrl('roomA', roomSecret);
    const badAdminStr = bytesToBase64url(new Uint8Array(16));

    await expect(joinRoom({ url, adminSecret: badAdminStr, user: USER }))
      .rejects.toThrow(InvalidAdminSecretError);
  });

  test('rejects malformed base64url admin override', async () => {
    const roomSecret = generateRoomSecret();
    const url = buildRoomJoinUrl('roomA', roomSecret);

    await expect(joinRoom({ url, adminSecret: 'not-valid-base64url!', user: USER }))
      .rejects.toThrow(InvalidAdminSecretError);
  });

  test('accepts valid 32-byte Uint8Array admin override', async () => {
    const roomSecret = generateRoomSecret();
    const url = buildRoomJoinUrl('roomA', roomSecret);
    const validAdmin = new Uint8Array(32);
    validAdmin[0] = 1;  // non-zero

    const client = await joinRoom({ url, adminSecret: validAdmin, user: USER });
    expect(client.getState().hasAdminCapability).toBe(true);
  });

  test('accepts valid 32-byte string admin override', async () => {
    const roomSecret = generateRoomSecret();
    const url = buildRoomJoinUrl('roomA', roomSecret);
    const validAdminStr = bytesToBase64url(new Uint8Array(32));

    const client = await joinRoom({ url, adminSecret: validAdminStr, user: USER });
    expect(client.getState().hasAdminCapability).toBe(true);
  });

  test('InvalidRoomUrlError is still thrown for malformed URL regardless of admin override', async () => {
    const validAdmin = new Uint8Array(32);
    await expect(joinRoom({ url: 'not-a-url', adminSecret: validAdmin, user: USER }))
      .rejects.toThrow(InvalidRoomUrlError);
  });
});
