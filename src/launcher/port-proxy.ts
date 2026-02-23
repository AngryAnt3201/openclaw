// ---------------------------------------------------------------------------
// Per-app transparent reverse proxy – each app gets a dedicated port on the
// gateway's external interface, forwarding to 127.0.0.1:{port}.
//
// No path rewriting, no HTML manipulation, no regex. Works with any framework.
// ---------------------------------------------------------------------------

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createConnection, type Socket } from "node:net";
import { pickPrimaryLanIPv4, isLoopbackAddress } from "../gateway/net.js";
import { pickPrimaryTailnetIPv4 } from "../infra/tailnet.js";

interface AppPortProxyEntry {
  appId: string;
  server: HttpServer;
  externalHost: string;
  externalPort: number;
  targetPort: number;
}

export class AppPortProxy {
  private readonly proxies = new Map<string, AppPortProxyEntry>();

  /**
   * Create a transparent reverse proxy for an app.
   * Binds to {externalHost}:{externalPort} and forwards everything to
   * 127.0.0.1:{targetPort} with no path manipulation.
   */
  async create(
    appId: string,
    opts: {
      externalHost: string;
      externalPort: number;
      targetPort: number;
    },
  ): Promise<{ url: string }> {
    // Tear down any existing proxy for this app
    if (this.proxies.has(appId)) {
      await this.destroy(appId);
    }

    const { externalHost, externalPort, targetPort } = opts;

    const server = createServer((req, res) => {
      this.proxyRequest(req, res, targetPort);
    });

    // Handle WebSocket upgrades transparently
    server.on("upgrade", (req, socket: Socket, head) => {
      this.proxyUpgrade(req, socket, head, targetPort);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(externalPort, externalHost, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    const entry: AppPortProxyEntry = {
      appId,
      server,
      externalHost,
      externalPort,
      targetPort,
    };
    this.proxies.set(appId, entry);

    return { url: `http://${externalHost}:${externalPort}` };
  }

  async destroy(appId: string): Promise<void> {
    const entry = this.proxies.get(appId);
    if (!entry) {
      return;
    }
    this.proxies.delete(appId);
    await new Promise<void>((resolve) => {
      entry.server.close(() => resolve());
      // Force-close any lingering connections
      entry.server.closeAllConnections?.();
    });
  }

  destroyAll(): void {
    for (const [, entry] of this.proxies) {
      entry.server.close();
      entry.server.closeAllConnections?.();
    }
    this.proxies.clear();
  }

  getUrl(appId: string): string | null {
    const entry = this.proxies.get(appId);
    if (!entry) {
      return null;
    }
    return `http://${entry.externalHost}:${entry.externalPort}`;
  }

  // ---- Internal ----

  private proxyRequest(req: IncomingMessage, res: ServerResponse, targetPort: number): void {
    const targetUrl = `http://127.0.0.1:${targetPort}${req.url ?? "/"}`;

    const proxyReq = httpRequest(
      targetUrl,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${targetPort}`,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "proxy connection failed" }));
    });

    req.pipe(proxyReq);
  }

  private proxyUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
    targetPort: number,
  ): void {
    const upstream = createConnection({ host: "127.0.0.1", port: targetPort }, () => {
      const url = req.url ?? "/";
      const reqLine = `${req.method} ${url} HTTP/1.1\r\n`;
      const headers = Object.entries(req.headers)
        .filter(([k]) => k !== "host")
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("\r\n");
      upstream.write(`${reqLine}host: 127.0.0.1:${targetPort}\r\n${headers}\r\n\r\n`);
      if (head.length > 0) {
        upstream.write(head);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    });

    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  }
}

// ---------------------------------------------------------------------------
// External bind IP resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the external IP that per-app proxies should bind to.
 *
 * - Specific non-loopback IP → return it directly
 * - 0.0.0.0 → first non-loopback IPv4 (LAN) or Tailscale IP
 * - 127.0.0.1 → null (can't create external proxies on loopback)
 */
export function resolveExternalBindIp(gatewayBindHost: string): string | null {
  // If the gateway is bound to a specific non-loopback IP, use it
  if (!isLoopbackAddress(gatewayBindHost) && gatewayBindHost !== "0.0.0.0") {
    return gatewayBindHost;
  }

  // Loopback → can't proxy externally
  if (isLoopbackAddress(gatewayBindHost)) {
    return null;
  }

  // 0.0.0.0 → pick best external IP
  // Prefer Tailscale IP (stable, routable)
  const tailnetIp = pickPrimaryTailnetIPv4();
  if (tailnetIp) {
    return tailnetIp;
  }

  // Fall back to LAN IP
  const lanIp = pickPrimaryLanIPv4();
  return lanIp ?? null;
}
