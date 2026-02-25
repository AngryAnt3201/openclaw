import { describe, it, expect, vi } from "vitest";
import type { PipelineNode } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeAppNode } from "./app.js";

function makeAppNode(overrides: Record<string, unknown> = {}): PipelineNode {
  return {
    id: "app-1",
    type: "app",
    label: "Test App Node",
    config: {
      appId: "my-app",
      prompt: "Navigate to /dashboard and summarize the metrics",
      session: "isolated" as const,
      lifecycle: "keep-alive" as const,
      ...overrides,
    },
    position: { x: 0, y: 0 },
    state: { status: "idle", retryCount: 0 },
  };
}

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    callGatewayRpc: vi.fn(),
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe("executeAppNode", () => {
  it("fails when appId is missing", async () => {
    const node = makeAppNode({ appId: "" });
    const result = await executeAppNode(node, undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/appId/i);
  });

  it("fails when prompt is missing", async () => {
    const node = makeAppNode({ prompt: "" });
    const result = await executeAppNode(node, undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/prompt/i);
  });

  it("fails when callGatewayRpc is not available", async () => {
    const node = makeAppNode();
    const result = await executeAppNode(node, undefined, {
      log: { info: vi.fn(), error: vi.fn() },
    });
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/callGatewayRpc/i);
  });

  it("looks up app and starts it if not healthy", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        id: "my-app",
        name: "My App",
        description: "A test app",
        port: 3001,
      })
      .mockResolvedValueOnce({ healthy: false })
      .mockResolvedValueOnce({
        pid: 123,
        port: 3001,
        status: "starting",
        proxyUrl: "http://100.70.238.120:3001",
      })
      .mockResolvedValueOnce({ healthy: true, uptimeMs: 1000 });
    const ctx = makeContext({
      callGatewayRpc: rpc,
      runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "ok", output: "done" }),
    });
    const result = await executeAppNode(makeAppNode(), undefined, ctx);
    expect(result.status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("launcher.get", { appId: "my-app" });
    expect(rpc).toHaveBeenCalledWith("launcher.start", { appId: "my-app" });
  });

  it("skips starting when app is already healthy", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        id: "my-app",
        name: "My App",
        description: "A test app",
        port: 3001,
      })
      .mockResolvedValueOnce({ healthy: true, uptimeMs: 5000 });
    const ctx = makeContext({
      callGatewayRpc: rpc,
      runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "ok", output: "done" }),
    });
    const result = await executeAppNode(makeAppNode(), undefined, ctx);
    expect(result.status).toBe("success");
    expect(rpc).not.toHaveBeenCalledWith("launcher.start", expect.anything());
  });

  it("uses main session when session=main", async () => {
    const enqueue = vi.fn();
    const heartbeat = vi.fn();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        id: "my-app",
        name: "My App",
        description: "A test app",
        port: 3001,
      })
      .mockResolvedValueOnce({ healthy: true, uptimeMs: 5000 });
    const ctx = makeContext({
      callGatewayRpc: rpc,
      enqueueSystemEvent: enqueue,
      requestHeartbeatNow: heartbeat,
    });
    const node = makeAppNode({ session: "main" });
    const result = await executeAppNode(node, undefined, ctx);
    expect(result.status).toBe("success");
    expect(enqueue).toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalled();
  });

  it("stops app after execution when lifecycle=ephemeral", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        id: "my-app",
        name: "My App",
        description: "A test app",
        port: 3001,
      })
      .mockResolvedValueOnce({ healthy: true, uptimeMs: 5000 })
      .mockResolvedValueOnce({ stopped: true });
    const ctx = makeContext({
      callGatewayRpc: rpc,
      runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "ok", output: "done" }),
    });
    const node = makeAppNode({ lifecycle: "ephemeral" });
    const result = await executeAppNode(node, undefined, ctx);
    expect(result.status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("launcher.stop", { appId: "my-app" });
  });

  it("includes upstream input in agent prompt", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        id: "my-app",
        name: "My App",
        description: "A test app",
        port: 3001,
      })
      .mockResolvedValueOnce({ healthy: true, uptimeMs: 5000 });
    const runJob = vi.fn().mockResolvedValue({ status: "ok", output: "done" });
    const ctx = makeContext({ callGatewayRpc: rpc, runIsolatedAgentJob: runJob });
    await executeAppNode(makeAppNode(), { data: "upstream result" }, ctx);
    const jobCall = runJob.mock.calls[0][0];
    expect(jobCall.message).toContain("upstream result");
  });

  it("returns failure when app not found", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(null);
    const result = await executeAppNode(
      makeAppNode(),
      undefined,
      makeContext({ callGatewayRpc: rpc }),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/not found/i);
  });
});
