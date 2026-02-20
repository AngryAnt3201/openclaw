import { createReadStream } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

interface AppProxyDeps {
  getAppPort: (appId: string) => Promise<number | null>;
}

const ICONS_DIR = join(homedir(), ".openclaw", "icons");

/**
 * HTTP reverse proxy for remote apps.
 * Route: /app-proxy/{appId}/{...path} → http://127.0.0.1:{port}/{path}
 */
export async function handleAppProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppProxyDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  // --- Icon serving: GET /icons/{fileId} ---
  const iconMatch = url.pathname.match(/^\/icons\/([a-zA-Z0-9_-]+)$/);
  if (iconMatch && req.method === "GET") {
    const fileId = iconMatch[1];
    const filePath = join(ICONS_DIR, `${fileId}.png`);
    return new Promise<boolean>((resolve) => {
      const stream = createReadStream(filePath);
      stream.on("open", () => {
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        });
        stream.pipe(res);
        resolve(true);
      });
      stream.on("error", () => {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain");
        res.end("Icon not found");
        resolve(true);
      });
    });
  }

  // --- App proxy: /app-proxy/{appId}/{...path} ---
  const proxyMatch = url.pathname.match(/^\/app-proxy\/([^/]+)(\/.*)?$/);
  if (!proxyMatch) {
    return false;
  }

  const appId = proxyMatch[1];
  const subPath = proxyMatch[2] ?? "/";

  // Reject path traversal attempts
  if (subPath.includes("..")) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid path" }));
    return true;
  }

  const port = await deps.getAppPort(appId);
  if (!port) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "app not found or no port configured" }));
    return true;
  }

  const targetUrl = `http://127.0.0.1:${port}${subPath}${url.search}`;

  return new Promise<boolean>((resolve) => {
    const proxyReq = httpRequest(
      targetUrl,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${port}`,
        },
      },
      (proxyRes) => {
        const location = proxyRes.headers.location;
        if (location && location.startsWith("/")) {
          proxyRes.headers.location = `/app-proxy/${appId}${location}`;
        }
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        resolve(true);
      },
    );

    proxyReq.on("error", () => {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "proxy connection failed" }));
      resolve(true);
    });

    req.pipe(proxyReq);
  });
}
