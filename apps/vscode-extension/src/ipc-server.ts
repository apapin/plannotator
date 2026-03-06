import * as http from "http";

/**
 * Lightweight HTTP server on localhost for receiving URLs from the router script.
 * Needed because vscode:// URI handlers don't work reliably on Linux.
 */
export function createIpcServer(
  onUrl: (url: string) => void,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = new globalThis.URL(req.url!, "http://localhost");
      const targetUrl = parsed.searchParams.get("url");

      if (req.method === "GET" && parsed.pathname === "/open" && targetUrl) {
        onUrl(targetUrl);
        res.writeHead(200);
        res.end("ok");
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    server.on("error", reject);
  });
}
