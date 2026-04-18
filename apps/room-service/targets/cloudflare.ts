/**
 * Cloudflare Worker entrypoint for room.plannotator.ai.
 *
 * Routes HTTP requests and WebSocket upgrades to the handler.
 * Re-exports the Durable Object class for wrangler discovery.
 */

import { handleRequest } from '../core/handler';
import { corsHeaders, getAllowedOrigins } from '../core/cors';
import type { Env } from '../core/types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = getAllowedOrigins(env.ALLOWED_ORIGINS);
    const allowLocalhost = env.ALLOW_LOCALHOST_ORIGINS === 'true';
    const cors = corsHeaders(origin, allowed, allowLocalhost);
    return handleRequest(request, env, cors);
  },
};

export { RoomDurableObject } from '../core/room-do';
