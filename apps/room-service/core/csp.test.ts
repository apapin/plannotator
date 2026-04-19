import { describe, expect, test } from 'bun:test';
import { ROOM_CSP, handleRequest } from './handler';

/** Parse a CSP directive into its individual tokens. */
function directiveTokens(csp: string, directive: string): string[] {
  const d = csp
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(directive));
  if (!d) return [];
  return d.split(/\s+/).slice(1); // drop the directive name itself
}

describe('ROOM_CSP constant', () => {
  test('is a non-empty string', () => {
    expect(typeof ROOM_CSP).toBe('string');
    expect(ROOM_CSP.length).toBeGreaterThan(0);
  });

  test("default-src is 'self'", () => {
    expect(ROOM_CSP).toContain("default-src 'self'");
  });

  test("script-src allows 'self' and 'wasm-unsafe-eval' only", () => {
    const tokens = directiveTokens(ROOM_CSP, 'script-src');
    expect(tokens).toContain("'self'");
    expect(tokens).toContain("'wasm-unsafe-eval'");
    // Must NOT contain plain 'unsafe-eval' or 'unsafe-inline'.
    expect(tokens).not.toContain("'unsafe-eval'");
    expect(tokens).not.toContain("'unsafe-inline'");
  });

  test('blocks object embeds', () => {
    expect(ROOM_CSP).toContain("object-src 'none'");
  });

  test('blocks base-uri injection', () => {
    expect(ROOM_CSP).toContain("base-uri 'none'");
  });

  test('blocks framing (clickjacking)', () => {
    expect(ROOM_CSP).toContain("frame-ancestors 'none'");
  });

  test('blocks form submissions', () => {
    expect(ROOM_CSP).toContain("form-action 'none'");
  });

  test('does NOT allow localhost HTTP connections', () => {
    // The room origin should not have blanket fetch access to any
    // local HTTP service; an XSS injection would otherwise exfiltrate
    // to loopback listeners. WebSocket entries below are intentionally
    // scoped to `ws://` only (HTTP loopback remains closed).
    const tokens = directiveTokens(ROOM_CSP, 'connect-src');
    expect(tokens).not.toContain('http://localhost:*');
    expect(tokens).not.toContain('http://127.0.0.1:*');
    expect(tokens).not.toContain('http://[::1]:*');
  });

  test('allows scoped localhost WebSocket connections (cross-port dev)', () => {
    expect(ROOM_CSP).toContain('ws://localhost:*');
    expect(ROOM_CSP).toContain('ws://127.0.0.1:*');
    expect(ROOM_CSP).toContain('ws://[::1]:*');
  });

  test('does NOT allow blanket https: / ws: / wss: in connect-src', () => {
    // `'self'` already covers same-origin wss:/ws: in prod and dev.
    // Blanket schemes would allow post-XSS exfiltration to any host on
    // that scheme — same reasoning that excludes blanket https:.
    const tokens = directiveTokens(ROOM_CSP, 'connect-src');
    expect(tokens).not.toContain('https:');
    expect(tokens).not.toContain('ws:');
    expect(tokens).not.toContain('wss:');
  });

  test('img-src allows remote markdown images (https:)', () => {
    // Remote `![alt](https://...)` in a plan document renders as a
    // plain <img src="https://..."> and must not be blocked. Annotation
    // attachments remain stripped at room-create time, so this allowance
    // only covers document-level markdown images.
    const tokens = directiveTokens(ROOM_CSP, 'img-src');
    expect(tokens).toContain("'self'");
    expect(tokens).toContain('https:');
    expect(tokens).toContain('data:');
    expect(tokens).toContain('blob:');
  });

  test('does NOT include upgrade-insecure-requests', () => {
    expect(ROOM_CSP).not.toContain('upgrade-insecure-requests');
  });

  test('allows Google Fonts', () => {
    expect(ROOM_CSP).toContain('https://fonts.googleapis.com');
    expect(ROOM_CSP).toContain('https://fonts.gstatic.com');
  });
});

describe('serveIndexHtml headers (fallback path, no ASSETS)', () => {
  // Minimal env with no ASSETS binding — exercises the fallback
  // HTML path inside handleRequest, which is the cheapest way to
  // assert the headers without needing a Durable Object namespace.
  const minimalEnv = {
    ROOM: {} as never,  // unused by the room-shell path
    ALLOWED_ORIGINS: 'https://room.plannotator.ai',
    ALLOW_LOCALHOST_ORIGINS: 'true',
    BASE_URL: 'https://room.plannotator.ai',
  };
  const cors = {
    'Access-Control-Allow-Origin': '*',
  };

  async function getRoom(roomId = 'AAAAAAAAAAAAAAAAAAAAAA'): Promise<Response> {
    const req = new Request(`https://room.plannotator.ai/c/${roomId}`, {
      method: 'GET',
    });
    return handleRequest(req, minimalEnv, cors);
  }

  test('returns 200 with Content-Security-Policy', async () => {
    const res = await getRoom();
    expect(res.status).toBe(200);
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
  });

  test('returns Cache-Control: no-store', async () => {
    const res = await getRoom();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('returns Referrer-Policy: no-referrer', async () => {
    const res = await getRoom();
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  test('returns text/html content type', async () => {
    const res = await getRoom();
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });
});
