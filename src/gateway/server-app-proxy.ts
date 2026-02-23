import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ICONS_DIR = join(homedir(), ".openclaw", "icons");

/**
 * Handle icon serving requests.
 * Route: GET /icons/{fileId} → ~/.openclaw/icons/{fileId}.png
 *
 * App proxying is now handled by per-port reverse proxies (AppPortProxy)
 * rather than path-prefix rewriting.
 */
export async function handleAppProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
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

  return false;
}
