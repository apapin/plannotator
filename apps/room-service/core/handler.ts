/**
 * HTTP route dispatch for room.plannotator.ai.
 *
 * Routes requests to the appropriate Durable Object or returns
 * static responses. Does NOT apply CORS to WebSocket upgrades.
 */

import type { Env } from './types';
import { validateCreateRoomRequest, isValidationError } from './validation';
import { safeLog } from './log';

const ROOM_PATH_RE = /^\/c\/([^/]+)$/;
const WS_PATH_RE = /^\/ws\/([^/]+)$/;

export async function handleRequest(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Health check
  if (pathname === '/health' && method === 'GET') {
    return Response.json({ ok: true }, { headers: cors });
  }

  // Room SPA shell placeholder (Slice 5 serves the real editor bundle)
  const roomMatch = pathname.match(ROOM_PATH_RE);
  if (roomMatch && method === 'GET') {
    const roomId = roomMatch[1];
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Plannotator Room</title></head><body><p>Room: ${escapeHtml(roomId)}</p><!-- Slice 5 replaces this with the editor bundle --></body></html>`,
      { status: 200, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // Assets placeholder — intentionally deferred to Slice 5
  if (pathname.startsWith('/assets/') && method === 'GET') {
    return Response.json(
      { error: 'Static assets not yet available' },
      { status: 404, headers: cors },
    );
  }

  // Room creation
  if (pathname === '/api/rooms' && method === 'POST') {
    return handleCreateRoom(request, env, cors);
  }

  // WebSocket upgrade
  const wsMatch = pathname.match(WS_PATH_RE);
  if (wsMatch && method === 'GET') {
    return handleWebSocket(request, env, wsMatch[1], cors);
  }

  // 404
  return Response.json(
    { error: 'Not found. Valid paths: GET /health, GET /c/:id, POST /api/rooms, GET /ws/:id' },
    { status: 404, headers: cors },
  );
}

// ---------------------------------------------------------------------------
// Room Creation
// ---------------------------------------------------------------------------

async function handleCreateRoom(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const result = validateCreateRoomRequest(body);
  if (isValidationError(result)) {
    return Response.json({ error: result.error }, { status: result.status, headers: cors });
  }

  safeLog('handler:create-room', { roomId: result.roomId });

  // Forward to the Durable Object
  const id = env.ROOM.idFromName(result.roomId);
  const stub = env.ROOM.get(id);
  const doResponse = await stub.fetch(
    new Request('http://do/create', {
      method: 'POST',
      body: JSON.stringify(result),
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  // Re-wrap DO response with CORS headers
  const responseBody = await doResponse.text();
  return new Response(responseBody, {
    status: doResponse.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// WebSocket Upgrade
// ---------------------------------------------------------------------------

async function handleWebSocket(
  request: Request,
  env: Env,
  roomId: string,
  cors: Record<string, string>,
): Promise<Response> {
  // Verify WebSocket upgrade header
  if (request.headers.get('Upgrade') !== 'websocket') {
    return Response.json(
      { error: 'Expected WebSocket upgrade' },
      { status: 426, headers: cors },
    );
  }

  // Forward to the Durable Object — no CORS on WebSocket upgrade
  const id = env.ROOM.idFromName(roomId);
  const stub = env.ROOM.get(id);
  return stub.fetch(request);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
