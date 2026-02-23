import { spawn, type ChildProcess } from "node:child_process";
import { request as httpGet } from "node:http";

export interface StartOptions {
  runCommand: string;
  workingDir: string;
  port: number;
  envVars?: Record<string, string>;
  healthCheckUrl?: string;
  /** Max ms to wait for health check (default 30000). */
  readyTimeoutMs?: number;
}

interface TrackedProcess {
  process: ChildProcess;
  pid: number;
  port: number;
  startedAtMs: number;
  healthCheckUrl?: string;
}

export interface StartResult {
  pid: number;
  port: number;
  status: "starting" | "running";
}

export interface HealthResult {
  pid: number;
  port: number;
  uptimeMs: number;
  healthy: boolean;
}

export class AppProcessManager {
  private readonly tracked = new Map<string, TrackedProcess>();

  async start(appId: string, opts: StartOptions): Promise<StartResult> {
    if (this.tracked.has(appId)) {
      throw new Error(`App "${appId}" is already running`);
    }

    const proc = spawn(opts.runCommand, {
      cwd: opts.workingDir,
      env: {
        ...process.env,
        ...opts.envVars,
        PORT: String(opts.port),
        // Force app to bind to loopback only — the gateway's per-port
        // proxy handles external access on the same port number.
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    const entry: TrackedProcess = {
      process: proc,
      pid: proc.pid ?? 0,
      port: opts.port,
      startedAtMs: Date.now(),
      healthCheckUrl: opts.healthCheckUrl,
    };

    this.tracked.set(appId, entry);

    proc.on("exit", () => {
      this.tracked.delete(appId);
    });

    // If a health check URL is configured, poll until it responds (or timeout).
    const checkUrl = opts.healthCheckUrl ?? `http://127.0.0.1:${opts.port}/`;
    const timeoutMs = opts.readyTimeoutMs ?? 30_000;
    const ready = await pollUntilReady(checkUrl, timeoutMs, proc);

    return { pid: entry.pid, port: opts.port, status: ready ? "running" : "starting" };
  }

  stop(appId: string): boolean {
    const entry = this.tracked.get(appId);
    if (!entry) {
      return false;
    }
    entry.process.kill("SIGTERM");
    this.tracked.delete(appId);
    return true;
  }

  health(appId: string): HealthResult | undefined {
    const entry = this.tracked.get(appId);
    if (!entry) {
      return undefined;
    }
    return {
      pid: entry.pid,
      port: entry.port,
      uptimeMs: Date.now() - entry.startedAtMs,
      healthy: !entry.process.killed,
    };
  }

  isTracked(appId: string): boolean {
    return this.tracked.has(appId);
  }

  shutdownAll(): void {
    for (const [, entry] of this.tracked) {
      entry.process.kill("SIGTERM");
    }
    this.tracked.clear();
  }
}

/** Poll a URL until it returns a 2xx/3xx, or give up after `timeoutMs`. */
function pollUntilReady(url: string, timeoutMs: number, proc: ChildProcess): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let done = false;

    const onExit = () => {
      if (!done) {
        done = true;
        resolve(false);
      }
    };
    proc.on("exit", onExit);

    const attempt = () => {
      if (done) {
        return;
      }
      if (Date.now() > deadline) {
        done = true;
        proc.off("exit", onExit);
        resolve(false);
        return;
      }

      const req = httpGet(url, { timeout: 2000 }, (res) => {
        const ok = res.statusCode !== undefined && res.statusCode < 400;
        res.resume(); // drain
        if (ok) {
          done = true;
          proc.off("exit", onExit);
          resolve(true);
        } else {
          setTimeout(attempt, 1000);
        }
      });
      req.on("error", () => {
        setTimeout(attempt, 1000);
      });
      req.end();
    };

    // Start polling after a short initial delay (give the process time to init)
    setTimeout(attempt, 500);
  });
}
