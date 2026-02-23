/**
 * Headless Session Manager
 *
 * Spawns and manages Claude CLI processes in `--print` mode with
 * streaming JSON I/O, replacing the Tauri-dependent ProcessManager +
 * SessionManager combo for headless (non-desktop) environments.
 *
 * Uses `--print --output-format stream-json --input-format stream-json
 * --include-partial-messages` so Claude works without a TTY.
 *
 * Output is accumulated in a ring buffer so clients can poll
 * incrementally (cursor-based, same contract as api_server.rs).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────

export type SessionStatus = "starting" | "running" | "active" | "done" | "error" | "killed";

export interface HeadlessSession {
  id: number;
  status: SessionStatus;
  mode: string;
  branch: string | null;
  projectPath: string;
  worktreePath: string | null;
  workingDirectory: string;
  createdAt: number;
  /** Accumulated human-readable output text. */
  outputBuffer: string;
  /** Monotonic cursor = total bytes written (clients send last cursor to get delta). */
  outputCursor: number;
  process: ChildProcess | null;
  exitCode: number | null;
}

/** Serialization-safe session info (no process handle, no raw buffer). */
export type HeadlessSessionInfo = Omit<HeadlessSession, "process" | "outputBuffer"> & {
  outputLength: number;
};

export interface CreateSessionParams {
  projectPath: string;
  branch?: string;
  mode?: string;
  initialPrompt?: string;
  skipPermissions?: boolean;
  customFlags?: string;
  env?: Record<string, string>;
}

type Logger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

// ── Constants ─────────────────────────────────────────────────────────

/** Max output buffer per session (2 MB). Older output is trimmed. */
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

/** Resolve the `claude` binary. */
function findClaudeBinary(): string {
  const candidates = [process.env.CLAUDE_BIN, "claude"].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const resolved = execSync(`which ${candidate}`, { encoding: "utf-8" }).trim();
      if (resolved) {
        return resolved;
      }
    } catch {
      // not found, try next
    }
  }

  // Fallback: check ~/.local/bin (common on Linux)
  const localBin = path.join(process.env.HOME ?? "", ".local", "bin", "claude");
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  return "claude";
}

// ── Worktree helpers ──────────────────────────────────────────────────

function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: dir, encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function branchExists(dir: string, branch: string): boolean {
  try {
    execSync(`git rev-parse --verify "${branch}"`, { cwd: dir, encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function prepareWorktree(projectPath: string, branch: string, log: Logger): string | null {
  if (!isGitRepo(projectPath)) {
    log.warn(`headless-session: ${projectPath} is not a git repo, skipping worktree`);
    return null;
  }

  const worktreeBase = path.join(projectPath, ".worktrees");
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, "_");
  const worktreePath = path.join(worktreeBase, safeBranch);

  if (fs.existsSync(worktreePath)) {
    log.info(`headless-session: reusing existing worktree at ${worktreePath}`);
    return worktreePath;
  }

  try {
    fs.mkdirSync(worktreeBase, { recursive: true });

    if (!branchExists(projectPath, branch)) {
      log.info(`headless-session: creating branch ${branch}`);
      execSync(`git branch "${branch}"`, { cwd: projectPath, encoding: "utf-8", stdio: "pipe" });
    }

    execSync(`git worktree add "${worktreePath}" "${branch}"`, {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: "pipe",
    });

    log.info(`headless-session: created worktree at ${worktreePath}`);
    return worktreePath;
  } catch (err) {
    log.warn(`headless-session: worktree creation failed: ${err}`);
    return null;
  }
}

// ── CLI argument builder ──────────────────────────────────────────────

function buildCliArgs(
  mode: string,
  skipPermissions: boolean,
  customFlags: string,
  initialPrompt?: string,
): string[] {
  // Use --print for headless operation (no TTY needed).
  // Plain text output on stdout, no interactive TUI.
  const args = ["--print"];

  if (skipPermissions) {
    switch (mode) {
      case "claude":
        args.push("--dangerously-skip-permissions");
        break;
      case "gemini":
        args.push("--yolo");
        break;
      case "codex":
        args.push("--dangerously-bypass-approvals-and-sandbox");
        break;
    }
  }

  const trimmed = customFlags.trim();
  if (trimmed) {
    args.push(...trimmed.split(/\s+/));
  }

  // Pass the initial prompt as the positional argument
  if (initialPrompt) {
    args.push(initialPrompt);
  }

  return args;
}

// ── HeadlessSessionManager ────────────────────────────────────────────

export class HeadlessSessionManager {
  private sessions = new Map<number, HeadlessSession>();
  private nextId = 1;
  private log: Logger;
  private claudeBin: string;

  constructor(log: Logger) {
    this.log = log;
    this.claudeBin = findClaudeBinary();
    this.log.info(`headless-session-manager: claude binary → ${this.claudeBin}`);
  }

  /** Create and start a new session. */
  async createSession(params: CreateSessionParams): Promise<HeadlessSessionInfo> {
    const id = this.nextId++;
    const mode = params.mode ?? "claude";
    const projectPath = path.resolve(params.projectPath);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }

    // Prepare worktree if branch specified
    let worktreePath: string | null = null;
    if (params.branch) {
      worktreePath = prepareWorktree(projectPath, params.branch, this.log);
    }

    const workingDirectory = worktreePath ?? projectPath;

    const session: HeadlessSession = {
      id,
      status: "starting",
      mode,
      branch: params.branch ?? null,
      projectPath,
      worktreePath,
      workingDirectory,
      createdAt: Date.now(),
      outputBuffer: "",
      outputCursor: 0,
      process: null,
      exitCode: null,
    };

    this.sessions.set(id, session);

    // Build args — in stream-json mode, initial prompt is the positional arg
    const cliArgs = buildCliArgs(
      mode,
      params.skipPermissions ?? false,
      params.customFlags ?? "",
      params.initialPrompt,
    );

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...params.env,
      BROWSER: "false",
      NO_COLOR: "1",
    };

    this.log.info(
      `headless-session: spawning session #${id} → ${this.claudeBin} ${cliArgs.slice(0, 6).join(" ")}… in ${workingDirectory}`,
    );

    try {
      const child = spawn(this.claudeBin, cliArgs, {
        cwd: workingDirectory,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
      });

      session.process = child;
      session.status = "running";

      // Close stdin immediately — in --print mode, the prompt is passed as a
      // positional arg.  Leaving stdin open causes Claude to wait for EOF.
      if (child.stdin) {
        child.stdin.end();
      }

      // Capture stdout (plain text in --print mode)
      child.stdout?.on("data", (chunk: Buffer) => {
        this.appendOutput(id, chunk.toString("utf-8"));
      });

      // Capture stderr
      child.stderr?.on("data", (chunk: Buffer) => {
        this.appendOutput(id, chunk.toString("utf-8"));
      });

      child.on("exit", (code, signal) => {
        const s = this.sessions.get(id);
        if (s) {
          s.exitCode = code ?? (signal ? 128 : 0);
          s.status = code === 0 ? "done" : "error";
          s.process = null;
          this.log.info(`headless-session: session #${id} exited (code=${code}, signal=${signal})`);
        }
      });

      child.on("error", (err) => {
        const s = this.sessions.get(id);
        if (s) {
          s.status = "error";
          s.process = null;
          this.appendOutput(id, `\n[spawn error: ${err.message}]\n`);
          this.log.error(`headless-session: session #${id} spawn error: ${err.message}`);
        }
      });
    } catch (err) {
      session.status = "error";
      this.appendOutput(id, `\n[failed to spawn: ${err}]\n`);
      this.log.error(`headless-session: failed to spawn session #${id}: ${err}`);
    }

    return this.toPublic(session);
  }

  /**
   * Send text to session stdin.
   *
   * Note: In `--print` mode, stdin is closed immediately after spawn
   * so the CLI processes the positional prompt.  This method will throw
   * for --print sessions.  For interactive follow-ups, create a new session.
   */
  sendInput(id: number, text: string): void {
    const session = this.sessions.get(id);
    if (!session?.process) {
      throw new Error(`Session ${id} is not running`);
    }
    if (!session.process.stdin?.writable) {
      throw new Error(`Session ${id} stdin is closed (--print mode sessions are non-interactive)`);
    }
    session.process.stdin.write(text);
  }

  /** Append output to session's ring buffer. */
  private appendOutput(sessionId: number, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.outputBuffer += text;
    session.outputCursor += text.length;

    if (session.outputBuffer.length > MAX_BUFFER_BYTES) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_BYTES);
    }
  }

  /** List all sessions (public detail). */
  listSessions(): HeadlessSessionInfo[] {
    return [...this.sessions.values()].map((s) => this.toPublic(s));
  }

  /** Get a single session by ID. */
  getSession(id: number): HeadlessSessionInfo | null {
    const s = this.sessions.get(id);
    return s ? this.toPublic(s) : null;
  }

  /** Get output since cursor. Returns new output and updated cursor. */
  getOutput(id: number, cursor?: number): { output: string; cursor: number } {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }

    const totalWritten = session.outputCursor;
    const bufLen = session.outputBuffer.length;

    if (cursor == null || cursor <= 0) {
      return { output: session.outputBuffer, cursor: totalWritten };
    }

    const bytesAgo = totalWritten - cursor;

    if (bytesAgo <= 0) {
      return { output: "", cursor: totalWritten };
    }

    if (bytesAgo >= bufLen) {
      return { output: session.outputBuffer, cursor: totalWritten };
    }

    const startIdx = bufLen - bytesAgo;
    return { output: session.outputBuffer.slice(startIdx), cursor: totalWritten };
  }

  /** Kill a session. */
  killSession(id: number): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }

    if (session.process) {
      session.status = "killed";
      session.process.kill("SIGTERM");
      const pid = session.process.pid;
      setTimeout(() => {
        try {
          if (pid) {
            process.kill(pid, 0);
          }
          process.kill(pid!, "SIGKILL");
        } catch {
          // already dead
        }
      }, 5_000);
    }
  }

  /** Kill all sessions (for graceful shutdown). */
  killAll(): void {
    for (const [id] of this.sessions) {
      try {
        this.killSession(id);
      } catch {
        // best effort
      }
    }
  }

  /** Remove a finished session from the map. */
  removeSession(id: number): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }
    if (session.process) {
      this.killSession(id);
    }
    return this.sessions.delete(id);
  }

  /** Number of sessions. */
  get count(): number {
    return this.sessions.size;
  }

  /** Strip the process handle for serialization. */
  private toPublic(session: HeadlessSession): HeadlessSessionInfo {
    const { process: _proc, outputBuffer: _buf, ...rest } = session;
    return { ...rest, outputLength: session.outputBuffer.length };
  }
}
