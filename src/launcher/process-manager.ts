import { spawn, type ChildProcess } from "node:child_process";

export interface StartOptions {
  runCommand: string;
  workingDir: string;
  port: number;
  envVars?: Record<string, string>;
  healthCheckUrl?: string;
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
  status: "starting";
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
      env: { ...process.env, ...opts.envVars, PORT: String(opts.port) },
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

    return { pid: entry.pid, port: opts.port, status: "starting" };
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
