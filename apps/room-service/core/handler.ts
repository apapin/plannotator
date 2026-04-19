/**
 * HTTP route dispatch for room.plannotator.ai.
 *
 * Routes requests to the appropriate Durable Object or returns
 * static responses. Does NOT apply CORS to WebSocket upgrades.
 */

import type { Env } from './types';
import { isRoomId, validateCreateRoomRequest, isValidationError } from './validation';
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

  // Room SPA shell placeholder (Slice 5 serves the real editor bundle).
  //
  // Defense-in-depth header: Referrer-Policy: no-referrer.
  // Note: browsers already do NOT include the URL fragment (#key=…&admin=…)
  // in outbound Referer headers, so the header isn't plugging a fragment
  // leak per se. What it does is belt-and-braces: it strips the *path*
  // (which contains the room id) from Referer on any outbound navigation
  // or subresource fetch the page performs, reducing room-id exposure to
  // third parties. The actual credential-leak risk for this page is
  // JavaScript telemetry reading `window.location.href` — Slice 5 editor
  // code must scrub `#key=` and `#admin=` from any telemetry /
  // error-reporting payload.
  const roomMatch = pathname.match(ROOM_PATH_RE);
  if (roomMatch && method === 'GET') {
    const roomId = roomMatch[1];
    // Validate up front so invalid URLs never reach the room shell (or,
    // in Slice 5, the editor bundle). Matches the /ws/:roomId validation.
    if (!isRoomId(roomId)) {
      return new Response('Not Found', { status: 404, headers: cors });
    }
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Plannotator Room</title></head><body><p>Room: ${escapeHtml(roomId)}</p><!-- Slice 5 replaces this with the editor bundle --></body></html>`,
      {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
        },
      },
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
//
// PRODUCTION HARDENING (required before public deployment, not in V1 scope):
// `POST /api/rooms` is intentionally unauthenticated in the V1 protocol. A
// room is a capability-token pair (roomSecret + adminSecret) the creator
// generates locally; this endpoint only asserts existence on the server, not
// identity. That means anyone who can reach the Worker can create rooms —
// fine for local dev and gated staging, NOT fine for the open internet.
//
// Before this Worker is exposed publicly it MUST be gated by one of:
//   - Cloudflare rate limiting / WAF rule keyed on source IP + path
//   - application-level throttle at the Worker entry (shared Durable Object
//     counter or KV-based token bucket)
//   - authenticated proxy (plannotator.ai app calls on behalf of signed-in users)
//
// CORS is NOT abuse protection — it's a browser same-origin policy and does
// nothing to a direct HTTP client. Any future reviewer flagging "this
// endpoint is unauthenticated" should be pointed HERE and to
// `specs/v1-implementation-approach.md` → "Production hardening: rate-limit
// POST /api/rooms". The protocol design accommodates this gating without
// client changes.
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

  // Validate roomId BEFORE idFromName(). idFromName on arbitrary attacker
  // input would instantiate a fresh DO and hit storage on every request —
  // a cheap abuse surface. Reject malformed IDs up front.
  if (!isRoomId(roomId)) {
    return Response.json(
      { error: 'Invalid roomId' },
      { status: 400, headers: cors },
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
