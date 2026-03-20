type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface Route {
  method: HttpMethod;
  path: string;
  handler: (req: Request) => Promise<Response>;
}

const routes: Route[] = [];

export function register(method: HttpMethod, path: string, handler: Route['handler']) {
  routes.push({ method, path, handler });
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method as HttpMethod;

  const route = routes.find(r => r.method === method && r.path === url.pathname);
  if (!route) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    return await route.handler(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Example routes
register('GET', '/api/health', async () => {
  return new Response(JSON.stringify({ status: 'ok', uptime: process.uptime() }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

register('POST', '/api/echo', async (req) => {
  const body = await req.json();
  return new Response(JSON.stringify({ received: body }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
