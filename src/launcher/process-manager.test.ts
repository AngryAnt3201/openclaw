import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppProcessManager } from "./process-manager.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const listeners: Record<string, Function[]> = {};
    const proc = {
      pid: 12345,
      killed: false,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: Function) => {
        if (!listeners[event]) {
          listeners[event] = [];
        }
        listeners[event].push(cb);
      }),
      off: vi.fn((event: string, cb: Function) => {
        const arr = listeners[event];
        if (arr) {
          const idx = arr.indexOf(cb);
          if (idx >= 0) {
            arr.splice(idx, 1);
          }
        }
      }),
      kill: vi.fn(function (this: typeof proc) {
        this.killed = true;
        return true;
      }),
      __emit: (event: string) => {
        for (const cb of listeners[event] ?? []) {
          cb();
        }
      },
    };
    return proc;
  }),
}));

// Mock http.request so pollUntilReady doesn't make real network calls.
// Default: return 200 immediately so start() resolves quickly.
vi.mock("node:http", () => ({
  request: vi.fn((_url: string, _opts: unknown, cb: Function) => {
    const res = {
      statusCode: 200,
      resume: vi.fn(),
    };
    // Simulate async response
    setTimeout(() => cb(res), 5);
    return {
      on: vi.fn(),
      end: vi.fn(),
    };
  }),
}));

describe("AppProcessManager", () => {
  let pm: AppProcessManager;

  beforeEach(() => {
    pm = new AppProcessManager();
  });

  afterEach(() => {
    pm.shutdownAll();
  });

  it("starts a process and tracks it by appId", async () => {
    const result = await pm.start("app-1", {
      runCommand: "node server.js",
      workingDir: "/tmp/app",
      port: 3001,
    });
    expect(result.pid).toBe(12345);
    expect(result.status).toBe("running"); // health check mock returns 200
    expect(pm.isTracked("app-1")).toBe(true);
  });

  it("stops a tracked process", async () => {
    await pm.start("app-2", {
      runCommand: "node server.js",
      workingDir: "/tmp/app",
      port: 3002,
    });
    const stopped = pm.stop("app-2");
    expect(stopped).toBe(true);
    expect(pm.isTracked("app-2")).toBe(false);
  });

  it("returns false when stopping unknown app", () => {
    expect(pm.stop("unknown")).toBe(false);
  });

  it("reports health for tracked apps", async () => {
    await pm.start("app-3", {
      runCommand: "node server.js",
      workingDir: "/tmp/app",
      port: 3003,
    });
    const health = pm.health("app-3");
    expect(health).toBeDefined();
    expect(health!.pid).toBe(12345);
    expect(health!.port).toBe(3003);
    expect(health!.healthy).toBe(true);
  });

  it("returns undefined health for unknown app", () => {
    expect(pm.health("unknown")).toBeUndefined();
  });

  it("shutdownAll kills all tracked processes", async () => {
    await pm.start("a1", { runCommand: "cmd", workingDir: "/tmp", port: 3001 });
    await pm.start("a2", { runCommand: "cmd", workingDir: "/tmp", port: 3002 });
    pm.shutdownAll();
    expect(pm.isTracked("a1")).toBe(false);
    expect(pm.isTracked("a2")).toBe(false);
  });

  it("rejects starting an already tracked app", async () => {
    await pm.start("dup", { runCommand: "cmd", workingDir: "/tmp", port: 4000 });
    await expect(
      pm.start("dup", { runCommand: "cmd", workingDir: "/tmp", port: 4000 }),
    ).rejects.toThrow(/already running/i);
  });
});
