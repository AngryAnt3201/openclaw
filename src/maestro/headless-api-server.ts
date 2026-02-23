/**
 * Headless API Server
 *
 * Lightweight Node.js HTTP server exposing the same REST API as the
 * Tauri `api_server.rs`.  Writes `~/.maestro/api-token` and
 * `~/.maestro/api-port` for discovery by `MaestroClient`.
 *
 * Backed by `HeadlessSessionManager` for process management.
 * Runs on a port in the 19000-19099 range (same as Tauri).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { HeadlessSessionManager, type CreateSessionParams } from "./headless-session-manager.js";

// ── Types ─────────────────────────────────────────────────────────────

type Logger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

// ── Discovery paths ───────────────────────────────────────────────────

const MAESTRO_DIR = path.join(process.env.HOME ?? "/tmp", ".maestro");
const TOKEN_PATH = path.join(MAESTRO_DIR, "api-token");
const PORT_PATH = path.join(MAESTRO_DIR, "api-port");

// ── Helpers ───────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function error(res: http.ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

// ── HeadlessApiServer ─────────────────────────────────────────────────

export class HeadlessApiServer {
  private server: http.Server | null = null;
  private sessionManager: HeadlessSessionManager;
  private log: Logger;
  private token: string;
  private port = 0;
  private instanceId: string;

  constructor(log: Logger) {
    this.log = log;
    this.token = crypto.randomUUID();
    this.instanceId = `headless-${crypto.randomUUID().slice(0, 8)}`;
    this.sessionManager = new HeadlessSessionManager(log);
  }

  /** Start the HTTP server and write discovery files. */
  async start(): Promise<{ port: number; token: string }> {
    if (this.server) {
      return { port: this.port, token: this.token };
    }

    // Find a free port in the 19000-19099 range
    this.port = await this.findPort();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, "127.0.0.1", () => resolve());
      this.server!.on("error", reject);
    });

    // Write discovery files
    this.writeDiscoveryFiles();

    this.log.info(
      `headless-api-server: listening on http://127.0.0.1:${this.port} (instance=${this.instanceId})`,
    );

    return { port: this.port, token: this.token };
  }

  /** Stop the server and clean up discovery files. */
  async stop(): Promise<void> {
    // Kill all sessions
    this.sessionManager.killAll();

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Clean up discovery files
    this.cleanDiscoveryFiles();

    this.log.info("headless-api-server: stopped");
  }

  /** Expose the session manager for direct access (e.g. from bridge). */
  get sessions(): HeadlessSessionManager {
    return this.sessionManager;
  }

  /** Whether the server is running. */
  get isRunning(): boolean {
    return this.server != null;
  }

  /** The port the server is listening on. */
  get listenPort(): number {
    return this.port;
  }

  // ── Port discovery ──────────────────────────────────────────────────

  private async findPort(): Promise<number> {
    // Try ports 19000-19099
    for (let p = 19000; p <= 19099; p++) {
      const available = await this.isPortAvailable(p);
      if (available) {
        return p;
      }
    }
    // Fallback: let OS pick
    return 0;
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = http.createServer();
      tester.listen(port, "127.0.0.1", () => {
        tester.close(() => resolve(true));
      });
      tester.on("error", () => resolve(false));
    });
  }

  // ── Discovery files ─────────────────────────────────────────────────

  private writeDiscoveryFiles(): void {
    try {
      fs.mkdirSync(MAESTRO_DIR, { recursive: true });
      fs.writeFileSync(TOKEN_PATH, this.token, { mode: 0o600 });
      fs.writeFileSync(PORT_PATH, String(this.port), { mode: 0o600 });
      this.log.info(`headless-api-server: wrote discovery files to ${MAESTRO_DIR}`);
    } catch (err) {
      this.log.error(`headless-api-server: failed to write discovery files: ${err}`);
    }
  }

  private cleanDiscoveryFiles(): void {
    try {
      // Only clean up if the files are ours (check token matches)
      const existingToken = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
      if (existingToken === this.token) {
        fs.unlinkSync(TOKEN_PATH);
        fs.unlinkSync(PORT_PATH);
        this.log.info("headless-api-server: cleaned up discovery files");
      }
    } catch {
      // Files may not exist — fine
    }
  }

  // ── Auth check ──────────────────────────────────────────────────────

  private checkAuth(req: http.IncomingMessage): boolean {
    const auth = req.headers.authorization ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return provided === this.token;
  }

  // ── Request router ──────────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    // CORS headers (for local dev)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (!this.checkAuth(req)) {
      error(res, 401, "Invalid or missing bearer token");
      return;
    }

    try {
      // Route matching
      if (pathname === "/api/v1/health" && method === "GET") {
        return this.handleHealth(res);
      }

      if (pathname === "/api/v1/sessions" && method === "GET") {
        return this.handleListSessions(res);
      }

      if (pathname === "/api/v1/sessions" && method === "POST") {
        return await this.handleCreateSession(req, res);
      }

      // /api/v1/sessions/:id
      const sessionMatch = pathname.match(/^\/api\/v1\/sessions\/(\d+)$/);
      if (sessionMatch) {
        const sessionId = Number(sessionMatch[1]);

        if (method === "GET") {
          return this.handleGetSession(res, sessionId);
        }
        if (method === "DELETE") {
          return this.handleKillSession(res, sessionId);
        }
      }

      // /api/v1/sessions/:id/input
      const inputMatch = pathname.match(/^\/api\/v1\/sessions\/(\d+)\/input$/);
      if (inputMatch && method === "POST") {
        const sessionId = Number(inputMatch[1]);
        return await this.handleSendInput(req, res, sessionId);
      }

      // /api/v1/sessions/:id/output
      const outputMatch = pathname.match(/^\/api\/v1\/sessions\/(\d+)\/output$/);
      if (outputMatch && method === "GET") {
        const sessionId = Number(outputMatch[1]);
        const cursor = url.searchParams.get("cursor");
        return this.handleGetOutput(res, sessionId, cursor ? Number(cursor) : undefined);
      }

      error(res, 404, `Not found: ${method} ${pathname}`);
    } catch (err) {
      this.log.error(`headless-api-server: request error: ${err}`);
      error(res, 500, String(err));
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────

  private handleHealth(res: http.ServerResponse): void {
    json(res, 200, {
      status: "ok",
      instance_id: this.instanceId,
      port: this.port,
      version: "headless-1.0.0",
    });
  }

  private handleListSessions(res: http.ServerResponse): void {
    const sessions = this.sessionManager.listSessions();
    json(
      res,
      200,
      sessions.map((s) => ({
        id: s.id,
        status: s.status,
        mode: s.mode,
        branch: s.branch,
        worktree_path: s.worktreePath,
        project_path: s.projectPath,
      })),
    );
  }

  private async handleCreateSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      error(res, 400, "Invalid JSON");
      return;
    }

    const params: CreateSessionParams = {
      projectPath: String(parsed.project_path ?? ""),
      branch: typeof parsed.branch === "string" ? parsed.branch : undefined,
      mode: typeof parsed.mode === "string" ? parsed.mode : undefined,
      initialPrompt: typeof parsed.initial_prompt === "string" ? parsed.initial_prompt : undefined,
      skipPermissions: parsed.skip_permissions === true,
      customFlags: typeof parsed.custom_flags === "string" ? parsed.custom_flags : undefined,
      env:
        typeof parsed.env === "object" && parsed.env != null
          ? (parsed.env as Record<string, string>)
          : undefined,
    };

    try {
      const session = await this.sessionManager.createSession(params);
      json(res, 201, {
        session_id: session.id,
        status: session.status,
        worktree_path: session.worktreePath,
        working_directory: session.workingDirectory,
      });
    } catch (err) {
      error(res, 500, `Failed to create session: ${err}`);
    }
  }

  private handleGetSession(res: http.ServerResponse, id: number): void {
    const session = this.sessionManager.getSession(id);
    if (!session) {
      error(res, 404, `Session ${id} not found`);
      return;
    }
    json(res, 200, {
      id: session.id,
      status: session.status,
      mode: session.mode,
      branch: session.branch,
      worktree_path: session.worktreePath,
      project_path: session.projectPath,
    });
  }

  private async handleSendInput(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: number,
  ): Promise<void> {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      error(res, 400, "Invalid JSON");
      return;
    }

    try {
      const text = String(parsed.text ?? "");
      this.sessionManager.sendInput(id, text);
      res.writeHead(204);
      res.end();
    } catch (err) {
      error(res, 500, String(err));
    }
  }

  private handleGetOutput(res: http.ServerResponse, id: number, cursor?: number): void {
    try {
      const result = this.sessionManager.getOutput(id, cursor);
      json(res, 200, result);
    } catch (err) {
      error(res, 404, String(err));
    }
  }

  private handleKillSession(res: http.ServerResponse, id: number): void {
    try {
      this.sessionManager.killSession(id);
      res.writeHead(204);
      res.end();
    } catch (err) {
      error(res, 404, String(err));
    }
  }
}
