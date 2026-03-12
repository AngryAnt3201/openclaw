// ---------------------------------------------------------------------------
// Fetch-Messages Executor – Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineNode, NodeConfig } from "../../types.js";
import type { ExecutorContext } from "../types.js";
import type { FetchMessagesOutput } from "./fetch-messages.js";
import { executeFetchMessages } from "./fetch-messages.js";

// ---------------------------------------------------------------------------
// Helpers / Factories
// ---------------------------------------------------------------------------

const DEFAULT_STATE = { status: "idle" as const, retryCount: 0 };

function makeNode(id = "fetch-messages"): PipelineNode {
  return {
    id,
    type: "code",
    label: id,
    config: { description: "fetch slack messages" } as NodeConfig,
    position: { x: 0, y: 0 },
    state: { ...DEFAULT_STATE },
  };
}

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    callGatewayRpc: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

/** Builds a minimal InboundMessage-like object for testing. */
function makeMsg(
  id: string,
  opts: {
    channelName?: string;
    channelId?: string;
    senderName?: string;
    body?: string;
    createdAtMs?: number;
    messageTs?: string;
    threadTs?: string;
  } = {},
) {
  const ts = opts.messageTs ?? String(opts.createdAtMs ?? Date.now());
  const threadTs = opts.threadTs ?? ts;
  return {
    id,
    source: {
      type: "slack",
      channelId: opts.channelId ?? "C001",
      channelName: opts.channelName ?? "general",
      senderId: "U001",
      senderName: opts.senderName ?? "Alice",
      platformMeta: {
        messageTs: ts,
        threadTs,
        slackChannelId: opts.channelId ?? "C001",
        slackChannelName: opts.channelName ?? "general",
      },
    },
    body: opts.body ?? "hello world",
    createdAtMs: opts.createdAtMs ?? 1_000_000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeFetchMessages", () => {
  let node: PipelineNode;

  beforeEach(() => {
    node = makeNode();
  });

  // -------------------------------------------------------------------------
  // 1. Basic: fetches since last run
  // -------------------------------------------------------------------------
  it("fetches messages using completedAtMs from last pipeline run", async () => {
    const rpc = vi.fn();
    const lastRunMs = 1_700_000_000_000;
    rpc.mockResolvedValueOnce({ runs: [{ completedAtMs: lastRunMs }] }); // pipeline.runs
    rpc.mockResolvedValueOnce({ messages: [makeMsg("m1")] }); // inbound.message.list

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    expect(result.status).toBe("success");
    // Second call should use lastRunMs as `since`
    const listCall = rpc.mock.calls[1];
    expect(listCall[0]).toBe("inbound.message.list");
    expect((listCall[1] as { since: number }).since).toBe(lastRunMs);
  });

  // -------------------------------------------------------------------------
  // 2. First run fallback — no previous runs → 12h lookback
  // -------------------------------------------------------------------------
  it("falls back to 12h lookback when no previous runs exist", async () => {
    const rpc = vi.fn();
    const before = Date.now();
    rpc.mockResolvedValueOnce({ runs: [] }); // pipeline.runs — empty
    rpc.mockResolvedValueOnce({ messages: [] }); // inbound.message.list
    const after = Date.now();

    const ctx = makeContext({ callGatewayRpc: rpc });
    await executeFetchMessages(node, undefined, ctx);

    const listCall = rpc.mock.calls[1];
    const since = (listCall[1] as { since: number }).since;
    const twelveHours = 12 * 60 * 60 * 1000;

    // since should be approximately now - 12h
    expect(since).toBeGreaterThanOrEqual(before - twelveHours - 1000);
    expect(since).toBeLessThanOrEqual(after - twelveHours + 1000);
  });

  it("falls back to 12h lookback when callGatewayRpc is not available", async () => {
    const ctx = makeContext({ callGatewayRpc: undefined });
    const result = await executeFetchMessages(node, undefined, ctx);
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/callGatewayRpc/i);
  });

  // -------------------------------------------------------------------------
  // 3. Zero messages
  // -------------------------------------------------------------------------
  it("returns empty result when no messages are found", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({ messages: [] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    expect(result.status).toBe("success");
    const output = result.output as FetchMessagesOutput;
    expect(output.empty).toBe(true);
    expect(output.formatted).toBe("");
    expect(output.messageCount).toBe(0);
    expect(output.channels).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 4. Groups messages by channel name
  // -------------------------------------------------------------------------
  it("groups messages by channelName", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({
      messages: [
        makeMsg("m1", { channelName: "general", body: "hello", createdAtMs: 1_000 }),
        makeMsg("m2", { channelName: "engineering", body: "world", createdAtMs: 2_000 }),
        makeMsg("m3", { channelName: "general", body: "bye", createdAtMs: 3_000 }),
      ],
    });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    expect(result.status).toBe("success");
    const output = result.output as FetchMessagesOutput;
    expect(output.channels).toContain("general");
    expect(output.channels).toContain("engineering");

    // Both channel headers should appear in formatted output
    expect(output.formatted).toContain("=== #general ===");
    expect(output.formatted).toContain("=== #engineering ===");
  });

  it("falls back to channelId when channelName is missing", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });

    const msg = makeMsg("m1", { createdAtMs: 1_000 });
    // Remove channelName
    delete (msg.source as { channelName?: string }).channelName;
    rpc.mockResolvedValueOnce({ messages: [msg] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    const output = result.output as FetchMessagesOutput;
    expect(output.channels).toContain("C001");
    expect(output.formatted).toContain("=== #C001 ===");
  });

  // -------------------------------------------------------------------------
  // 5. Sorts messages by createdAtMs (ascending)
  // -------------------------------------------------------------------------
  it("sorts messages within a channel by createdAtMs ascending", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({
      messages: [
        makeMsg("m3", {
          channelName: "general",
          body: "third",
          createdAtMs: 3_000,
          messageTs: "3000",
        }),
        makeMsg("m1", {
          channelName: "general",
          body: "first",
          createdAtMs: 1_000,
          messageTs: "1000",
        }),
        makeMsg("m2", {
          channelName: "general",
          body: "second",
          createdAtMs: 2_000,
          messageTs: "2000",
        }),
      ],
    });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    const output = result.output as FetchMessagesOutput;
    const firstIdx = output.formatted.indexOf("first");
    const secondIdx = output.formatted.indexOf("second");
    const thirdIdx = output.formatted.indexOf("third");

    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  // -------------------------------------------------------------------------
  // 6. Caps at 500 messages
  // -------------------------------------------------------------------------
  it("caps output at 500 messages when more are returned", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });

    // Generate 600 messages
    const messages = Array.from({ length: 600 }, (_, i) =>
      makeMsg(`m${i}`, {
        channelName: "general",
        createdAtMs: i * 1000,
        messageTs: String(i * 1000),
      }),
    );
    rpc.mockResolvedValueOnce({ messages });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    expect(result.status).toBe("success");
    const output = result.output as FetchMessagesOutput;
    expect(output.messageCount).toBe(500);
    expect(output.capped).toBe(true);
  });

  it("does not set capped when messages are under the limit", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({ messages: [makeMsg("m1", { createdAtMs: 1000 })] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    const output = result.output as FetchMessagesOutput;
    expect(output.capped).toBeFalsy();
    expect(output.messageCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 7. Thread nesting: replies indented under root messages
  // -------------------------------------------------------------------------
  it("nests thread replies under root messages with indentation", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });

    // Root message: messageTs === threadTs
    const rootMsg = makeMsg("root", {
      channelName: "general",
      body: "root message",
      createdAtMs: 1_000,
      messageTs: "1000",
      threadTs: "1000",
    });

    // Reply: messageTs !== threadTs (threadTs points to root)
    const replyMsg = makeMsg("reply", {
      channelName: "general",
      body: "reply message",
      createdAtMs: 2_000,
      messageTs: "2000",
      threadTs: "1000", // same as root's messageTs → it's a reply
    });

    rpc.mockResolvedValueOnce({ messages: [rootMsg, replyMsg] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    const output = result.output as FetchMessagesOutput;
    // Root message should appear without indentation prefix
    // Reply should appear with indented prefix
    expect(output.formatted).toContain("root message");
    expect(output.formatted).toContain("reply message");

    // The reply should be indented with ↳ prefix
    expect(output.formatted).toContain("↳");

    // Reply should come AFTER root in formatted text
    const rootIdx = output.formatted.indexOf("root message");
    const replyIdx = output.formatted.indexOf("reply message");
    expect(rootIdx).toBeLessThan(replyIdx);
  });

  it("treats message as root when platformMeta is absent", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });

    const msg = makeMsg("m1", { channelName: "general", body: "standalone", createdAtMs: 1_000 });
    // Remove platformMeta entirely
    delete (msg.source as { platformMeta?: unknown }).platformMeta;
    rpc.mockResolvedValueOnce({ messages: [msg] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    expect(result.status).toBe("success");
    const output = result.output as FetchMessagesOutput;
    expect(output.formatted).toContain("standalone");
    // No ↳ prefix — it's not a reply
    expect(output.formatted).not.toContain("↳");
  });

  // -------------------------------------------------------------------------
  // 8. Output shape
  // -------------------------------------------------------------------------
  it("includes windowStart and windowEnd in the output", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [{ completedAtMs: 1_700_000_000_000 }] });
    rpc.mockResolvedValueOnce({ messages: [makeMsg("m1", { createdAtMs: 1_700_000_001_000 })] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    const output = result.output as FetchMessagesOutput;
    expect(output.windowStart).toBe(1_700_000_000_000);
    expect(output.windowEnd).toBeTypeOf("number");
    expect(output.windowEnd).toBeGreaterThan(output.windowStart);
  });

  it("includes durationMs in the result", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({ messages: [] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    expect(result.durationMs).toBeTypeOf("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 9. Error handling
  // -------------------------------------------------------------------------
  it("falls back to 12h lookback when pipeline.runs RPC throws", async () => {
    const before = Date.now();
    const rpc = vi.fn();
    rpc.mockRejectedValueOnce(new Error("gateway error")); // pipeline.runs throws
    rpc.mockResolvedValueOnce({ messages: [] }); // inbound.message.list succeeds
    const after = Date.now();

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    // Should still succeed — falls back to 12h window
    expect(result.status).toBe("success");
    const listCall = rpc.mock.calls[1];
    const since = (listCall[1] as { since: number }).since;
    const twelveHours = 12 * 60 * 60 * 1000;
    expect(since).toBeGreaterThanOrEqual(before - twelveHours - 1000);
    expect(since).toBeLessThanOrEqual(after - twelveHours + 1000);
  });

  it("returns failure when inbound.message.list RPC throws", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockRejectedValueOnce(new Error("list failed"));

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/list failed/i);
  });

  it("logs errors via context.log.error on failure", async () => {
    const logError = vi.fn();
    const rpc = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const ctx = makeContext({ callGatewayRpc: rpc, log: { info: vi.fn(), error: logError } });

    await executeFetchMessages(node, undefined, ctx);
    expect(logError).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. Formatted output includes sender name and body
  // -------------------------------------------------------------------------
  it("includes sender name and message body in formatted output", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({
      messages: [
        makeMsg("m1", {
          channelName: "general",
          senderName: "Bob",
          body: "check this out",
          createdAtMs: 1_700_000_000_000,
        }),
      ],
    });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const result = await executeFetchMessages(node, undefined, ctx);

    const output = result.output as FetchMessagesOutput;
    expect(output.formatted).toContain("Bob");
    expect(output.formatted).toContain("check this out");
  });

  // -------------------------------------------------------------------------
  // 11. pipeline.runs is called with correct params
  // -------------------------------------------------------------------------
  it("calls pipeline.runs with the builtin slack-digest pipeline id", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({ messages: [] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    await executeFetchMessages(node, undefined, ctx);

    const runsCall = rpc.mock.calls[0];
    expect(runsCall[0]).toBe("pipeline.runs");
    expect((runsCall[1] as { id: string }).id).toBe("builtin:slack-digest");
    expect((runsCall[1] as { limit: number }).limit).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 12. inbound.message.list is called with sourceType: "slack"
  // -------------------------------------------------------------------------
  it("calls inbound.message.list with sourceType slack", async () => {
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ runs: [] });
    rpc.mockResolvedValueOnce({ messages: [] });

    const ctx = makeContext({ callGatewayRpc: rpc });
    await executeFetchMessages(node, undefined, ctx);

    const listCall = rpc.mock.calls[1];
    expect(listCall[0]).toBe("inbound.message.list");
    expect((listCall[1] as { sourceType: string }).sourceType).toBe("slack");
  });
});
