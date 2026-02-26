/**
 * Maestro Node Bridge
 *
 * Auto-started by the gateway on startup.  Detects whether a local Maestro
 * instance is running (probes ~/.maestro/api-token + ~/.maestro/api-port)
 * and, if so, registers as a virtual node in the gateway's NodeRegistry.
 *
 * **Headless fallback**: If no Tauri desktop app is detected after the
 * first probe, auto-starts a `HeadlessApiServer` that writes the same
 * discovery files and exposes the identical REST API backed by
 * `HeadlessSessionManager` (spawns `claude` via child_process).
 *
 * Incoming `node.invoke.request` commands are routed to the local Maestro
 * REST API.  Session list changes and terminal output are emitted as
 * gateway events that flow to connected operator clients (i.e. the Maestro
 * sub-app in Miranda).
 */

import os from "node:os";
import type { NodeRegistry, NodeInvokeResult } from "../gateway/node-registry.js";
import {
  tryCreateMaestroClient,
  type MaestroClient,
  type MaestroSessionDetail,
} from "../agents/tools/maestro-client.js";
import { handleFileList, handleFileRead, handleFileStat } from "../node-host/file-commands.js";
import { HeadlessApiServer } from "./headless-api-server.js";

type Logger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
type BroadcastFn = (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;

const PROBE_INTERVAL_MS = 10_000; // check for Maestro every 10s when not connected
const POLL_INTERVAL_MS = 2_000; // poll sessions + output every 2s when connected
const OUTPUT_THROTTLE_MS = 500; // max 1 output event per session per 500ms

function makeNodeId(): string {
  return `maestro-${os.hostname()}`;
}

export class MaestroNodeBridge {
  private nodeRegistry: NodeRegistry;
  private broadcast: BroadcastFn;
  private log: Logger;
  private client: MaestroClient | null = null;
  private nodeId: string;
  private registered = false;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private headlessServer: HeadlessApiServer | null = null;
  private headlessStarting = false;

  // Output cursor tracking per session
  private outputCursors = new Map<number, number>();
  private lastOutputEmit = new Map<number, number>();
  // Track known sessions for change detection
  private knownSessionIds = new Set<number>();

  constructor(nodeRegistry: NodeRegistry, broadcast: BroadcastFn, log: Logger) {
    this.nodeRegistry = nodeRegistry;
    this.broadcast = broadcast;
    this.log = log;
    this.nodeId = makeNodeId();
  }

  /** Start probing for Maestro. */
  start(): void {
    if (this.stopped) {
      return;
    }
    this.tryConnect();
    this.probeTimer = setInterval(() => {
      if (!this.registered) {
        this.tryConnect();
      }
    }, PROBE_INTERVAL_MS);
  }

  /** Stop all timers, unregister, and shut down headless server if running. */
  stop(): void {
    this.stopped = true;
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.unregisterNode();
    if (this.headlessServer) {
      void this.headlessServer.stop();
      this.headlessServer = null;
    }
  }

  // ── Probe & connect ──────────────────────────────────────────────────

  private tryConnect(): void {
    const client = tryCreateMaestroClient();

    if (client) {
      // Tauri desktop or headless server already running — verify health
      client
        .health()
        .then(() => {
          if (this.stopped) {
            return;
          }
          this.client = client;
          this.registerNode();
          this.startPolling();
          this.log.info(`maestro-bridge: connected to Maestro as node "${this.nodeId}"`);
        })
        .catch(() => {
          // Discovery files exist but nothing is responding — stale from a
          // previous run.  Fall through to headless server startup so we
          // don't spin forever on dead ports.
          this.startHeadlessIfNeeded();
        });
      return;
    }

    // No discovery files found — start headless server if not already started
    this.startHeadlessIfNeeded();
  }

  private startHeadlessIfNeeded(): void {
    if (this.headlessServer || this.headlessStarting || this.stopped) {
      return;
    }
    this.headlessStarting = true;
    this.log.info("maestro-bridge: starting headless API server…");
    const server = new HeadlessApiServer(this.log);
    server
      .start()
      .then(() => {
        if (this.stopped) {
          void server.stop();
          return;
        }
        this.headlessServer = server;
        this.headlessStarting = false;
        this.log.info(`maestro-bridge: headless API server running on port ${server.listenPort}`);
        // Now retry — discovery files are written, MaestroClient should connect
        this.tryConnect();
      })
      .catch((err) => {
        this.headlessStarting = false;
        this.log.error(`maestro-bridge: failed to start headless API server: ${err}`);
      });
  }

  private registerNode(): void {
    if (this.registered) {
      return;
    }
    this.registered = true;

    const caps = ["maestro:sessions", "file"];
    const commands = [
      "maestro.session.list",
      "maestro.session.create",
      "maestro.session.status",
      "maestro.session.input",
      "maestro.session.output",
      "maestro.session.kill",
      "file.list",
      "file.read",
      "file.stat",
    ];

    // Register as a virtual node so node.list / node.invoke work natively
    this.nodeRegistry.registerVirtual(this.nodeId, this.handleCommand.bind(this), {
      displayName: os.hostname(),
      platform: process.platform,
      caps,
      commands,
    });

    // Also broadcast for backward compat with event-listening clients
    this.broadcast(
      "node.connected",
      { nodeId: this.nodeId, displayName: os.hostname(), caps, commands },
      { dropIfSlow: true },
    );
  }

  private unregisterNode(): void {
    if (!this.registered) {
      return;
    }
    this.registered = false;
    this.client = null;
    this.outputCursors.clear();
    this.lastOutputEmit.clear();
    this.knownSessionIds.clear();
    this.nodeRegistry.unregisterVirtual(this.nodeId);
    this.broadcast("node.disconnected", { nodeId: this.nodeId }, { dropIfSlow: true });
  }

  // ── Polling loop ──────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.pollCycle();
    }, POLL_INTERVAL_MS);
    // Run first poll immediately
    void this.pollCycle();
  }

  private async pollCycle(): Promise<void> {
    if (!this.client || this.stopped) {
      return;
    }

    try {
      const sessions = await this.client.listSessions();
      this.detectSessionChanges(sessions);
      await this.pollOutputForActiveSessions(sessions);
    } catch {
      // Maestro likely went down — unregister and resume probing
      this.log.warn("maestro-bridge: Maestro became unreachable, unregistering node");
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.unregisterNode();
    }
  }

  private detectSessionChanges(sessions: MaestroSessionDetail[]): void {
    const currentIds = new Set(sessions.map((s) => s.id));
    const changed =
      currentIds.size !== this.knownSessionIds.size ||
      [...currentIds].some((id) => !this.knownSessionIds.has(id));

    if (changed) {
      this.knownSessionIds = currentIds;
      // Clean up cursors for removed sessions
      for (const id of this.outputCursors.keys()) {
        if (!currentIds.has(id)) {
          this.outputCursors.delete(id);
          this.lastOutputEmit.delete(id);
        }
      }
      this.broadcast(
        "maestro.sessions.changed",
        {
          nodeId: this.nodeId,
          sessions: sessions.map((s) => ({
            id: s.id,
            status: s.status,
            mode: s.mode,
            branch: s.branch,
            projectPath: s.project_path,
            worktreePath: s.worktree_path,
          })),
        },
        { dropIfSlow: true },
      );
    }
  }

  private async pollOutputForActiveSessions(sessions: MaestroSessionDetail[]): Promise<void> {
    if (!this.client) {
      return;
    }
    const now = Date.now();

    const active = sessions.filter((s) => s.status === "running" || s.status === "active");

    for (const session of active) {
      // Throttle
      const lastEmit = this.lastOutputEmit.get(session.id) ?? 0;
      if (now - lastEmit < OUTPUT_THROTTLE_MS) {
        continue;
      }

      const cursor = this.outputCursors.get(session.id) ?? 0;
      try {
        const result = await this.client.getOutput(session.id, cursor);
        if (result.output && result.cursor > cursor) {
          this.outputCursors.set(session.id, result.cursor);
          this.lastOutputEmit.set(session.id, now);
          this.broadcast(
            "maestro.output",
            {
              nodeId: this.nodeId,
              sessionId: session.id,
              output: result.output,
              cursor: result.cursor,
            },
            { dropIfSlow: true },
          );
        }
      } catch {
        // Individual session output failure — non-fatal
      }
    }
  }

  // ── Command handling (called by gateway) ──────────────────────────────

  /**
   * Handle an invoke command directed at this maestro node.
   * Returns the result payload.
   */
  async handleCommand(command: string, params: unknown): Promise<NodeInvokeResult> {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;

    // File commands work even when Maestro client is not connected
    try {
      switch (command) {
        case "file.list": {
          const result = await handleFileList({
            path: String(p.path ?? ""),
            hidden: typeof p.hidden === "boolean" ? p.hidden : undefined,
            limit: typeof p.limit === "number" ? p.limit : undefined,
          });
          return { ok: true, payload: result };
        }
        case "file.read": {
          const result = await handleFileRead({
            path: String(p.path ?? ""),
            offset: typeof p.offset === "number" ? p.offset : undefined,
            limit: typeof p.limit === "number" ? p.limit : undefined,
            encoding: p.encoding === "base64" ? "base64" : undefined,
          });
          return { ok: true, payload: result };
        }
        case "file.stat": {
          const result = await handleFileStat({ path: String(p.path ?? "") });
          return { ok: true, payload: result };
        }
        default:
          break; // fall through to maestro commands below
      }
    } catch (err) {
      return {
        ok: false,
        error: { code: "FILE_ERROR", message: String(err) },
      };
    }

    // Maestro commands require an active client
    if (!this.client) {
      return { ok: false, error: { code: "NOT_AVAILABLE", message: "Maestro not connected" } };
    }

    try {
      switch (command) {
        case "maestro.session.list": {
          const sessions = await this.client.listSessions();
          return {
            ok: true,
            payload: sessions.map((s) => ({
              id: s.id,
              status: s.status,
              mode: s.mode,
              branch: s.branch,
              projectPath: s.project_path,
              worktreePath: s.worktree_path,
            })),
          };
        }
        case "maestro.session.create": {
          const session = await this.client.createSession({
            projectPath: String(p.projectPath ?? ""),
            branch: typeof p.branch === "string" ? p.branch : undefined,
            mode: typeof p.mode === "string" ? p.mode : undefined,
            initialPrompt: typeof p.initialPrompt === "string" ? p.initialPrompt : undefined,
            skipPermissions: p.skipPermissions === true,
            customFlags: typeof p.customFlags === "string" ? p.customFlags : undefined,
          });
          return { ok: true, payload: session };
        }
        case "maestro.session.status": {
          const id = Number(p.sessionId);
          if (Number.isNaN(id)) {
            return { ok: false, error: { code: "INVALID_PARAMS", message: "missing sessionId" } };
          }
          const detail = await this.client.getSession(id);
          return { ok: true, payload: detail };
        }
        case "maestro.session.input": {
          const id = Number(p.sessionId);
          const text = String(p.text ?? "");
          if (Number.isNaN(id)) {
            return { ok: false, error: { code: "INVALID_PARAMS", message: "missing sessionId" } };
          }
          await this.client.sendInput(id, text);
          return { ok: true };
        }
        case "maestro.session.output": {
          const id = Number(p.sessionId);
          const cursor = typeof p.cursor === "number" ? p.cursor : undefined;
          if (Number.isNaN(id)) {
            return { ok: false, error: { code: "INVALID_PARAMS", message: "missing sessionId" } };
          }
          const result = await this.client.getOutput(id, cursor);
          return { ok: true, payload: result };
        }
        case "maestro.session.kill": {
          const id = Number(p.sessionId);
          if (Number.isNaN(id)) {
            return { ok: false, error: { code: "INVALID_PARAMS", message: "missing sessionId" } };
          }
          await this.client.killSession(id);
          return { ok: true };
        }
        default:
          return { ok: false, error: { code: "UNKNOWN_COMMAND", message: `unknown: ${command}` } };
      }
    } catch (err) {
      return {
        ok: false,
        error: { code: "MAESTRO_ERROR", message: String(err) },
      };
    }
  }

  /** Expose node ID for routing. */
  get id(): string {
    return this.nodeId;
  }

  /** Whether the bridge currently has a live Maestro connection. */
  get isConnected(): boolean {
    return this.registered;
  }
}
