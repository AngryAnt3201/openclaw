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
 *
 * For HTML responses, rewrites absolute paths (e.g. /@vite/client, /src/...)
 * to include the proxy prefix so the browser loads them through the proxy.
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
  const proxyPrefix = `/app-proxy/${appId}`;

  return new Promise<boolean>((resolve) => {
    const proxyReq = httpRequest(
      targetUrl,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${port}`,
          // Don't send compressed encoding — we need to read & rewrite HTML
          "accept-encoding": "identity",
        },
      },
      (proxyRes) => {
        // Rewrite Location headers
        const location = proxyRes.headers.location;
        if (location && location.startsWith("/")) {
          proxyRes.headers.location = `${proxyPrefix}${location}`;
        }

        const contentType = proxyRes.headers["content-type"] ?? "";
        const isHtml = contentType.includes("text/html");

        if (isHtml) {
          // Buffer HTML response and rewrite absolute paths
          const chunks: Buffer[] = [];
          proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
          proxyRes.on("end", () => {
            let html = Buffer.concat(chunks).toString("utf-8");
            html = rewriteHtml(html, proxyPrefix);
            // Remove content-length since body size changed
            const headers = { ...proxyRes.headers };
            delete headers["content-length"];
            headers["content-length"] = String(Buffer.byteLength(html));
            res.writeHead(proxyRes.statusCode ?? 502, headers);
            res.end(html);
            resolve(true);
          });
        } else {
          // Stream non-HTML responses directly
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
          resolve(true);
        }
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

/**
 * Rewrite absolute paths in HTML so they route through the proxy.
 *
 * Handles common patterns from Vite, webpack, and static servers:
 *   src="/..."  href="/..."  from "/..."  url("/...")
 *   import("/...")  import '/...'
 *
 * Also injects a <base> tag for any paths we might miss, and patches
 * the Vite HMR WebSocket to connect through the proxy path.
 */
function rewriteHtml(html: string, prefix: string): string {
  // Rewrite src="/" href="/" action="/" attributes
  html = html.replace(
    /(\s(?:src|href|action|poster|data)=["'])(\/(?!\/)[^"']*)/gi,
    `$1${prefix}$2`,
  );

  // Rewrite url(/) in inline styles
  html = html.replace(/(url\(["']?)(\/(?!\/)[^"')]*)/gi, `$1${prefix}$2`);

  // Rewrite import("/..."), import '/...', and from "/..." in inline scripts
  html = html.replace(/((?:import|from)\s*\(?\s*["'])(\/(?!\/)[^"']*)/g, `$1${prefix}$2`);

  // Rewrite fetch("/...") in inline scripts
  html = html.replace(/(fetch\s*\(\s*["'])(\/(?!\/)[^"']*)/g, `$1${prefix}$2`);

  // Inject a script to patch Vite HMR WebSocket connection
  // so it connects via the proxy path instead of root
  const hmrPatch = `<script>
// Patch Vite HMR to use proxy path
window.__vite_proxy_base__ = "${prefix}";
</script>`;

  // Insert before the first <script> tag
  const scriptIdx = html.indexOf("<script");
  if (scriptIdx !== -1) {
    html = html.slice(0, scriptIdx) + hmrPatch + html.slice(scriptIdx);
  }

  return html;
}
