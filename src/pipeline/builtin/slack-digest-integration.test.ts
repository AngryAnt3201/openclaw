import { describe, it, expect, vi } from "vitest";
import type { ExecutorContext } from "../executor/types.js";
import { executeFetchMessages } from "../executor/slack-digest/fetch-messages.js";
import { buildSlackDigestPipelineCreate } from "./slack-digest-pipeline.js";

describe("Slack Digest Pipeline — Integration", () => {
  it("fetch-messages produces output consumable by agent summarizer", async () => {
    const messages = [
      {
        id: "m1",
        source: {
          type: "slack",
          channelId: "C001",
          channelName: "#general",
          senderName: "alice",
          platformMeta: { messageTs: "1710000000.000100" },
        },
        body: "We need to renew the Acme contract by Friday",
        status: "pending",
        priority: "medium",
        createdAtMs: 1710000000000,
        updatedAtMs: 1710000000000,
      },
      {
        id: "m2",
        source: {
          type: "slack",
          channelId: "C002",
          channelName: "#sales",
          senderName: "bob",
          platformMeta: { messageTs: "1710000001.000100" },
        },
        body: "Got an inbound lead from the conference - CTO of TechCorp wants a demo",
        status: "pending",
        priority: "medium",
        createdAtMs: 1710000001000,
        updatedAtMs: 1710000001000,
      },
    ];

    const ctx: ExecutorContext = {
      callGatewayRpc: vi
        .fn()
        .mockResolvedValueOnce({ runs: [] })
        .mockResolvedValueOnce({ messages }),
      log: { info: vi.fn(), error: vi.fn() },
    };

    const pipelineCreate = buildSlackDigestPipelineCreate();
    const fetchNode = pipelineCreate.nodes!.find((n) => n.id === "fetch-messages")!;

    const result = await executeFetchMessages(fetchNode, undefined, ctx);

    expect(result.status).toBe("success");
    const output = result.output as Record<string, unknown>;
    expect(output.empty).toBe(false);
    expect(output.messageCount).toBe(2);
    expect(output.channels).toContain("#general");
    expect(output.channels).toContain("#sales");

    const formatted = output.formatted as string;
    expect(formatted).toContain("Acme contract");
    expect(formatted).toContain("TechCorp");
    expect(formatted).toContain("alice");
    expect(formatted).toContain("bob");
    expect(formatted).toContain("#general");
    expect(formatted).toContain("#sales");
  });

  it("pipeline definition has valid node types and edge connectivity", () => {
    const create = buildSlackDigestPipelineCreate();
    const nodeIds = new Set(create.nodes!.map((n) => n.id));

    // All edge sources and targets reference valid nodes
    for (const edge of create.edges!) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }

    // All edges have id fields
    for (const edge of create.edges!) {
      expect(edge.id).toBeTruthy();
    }

    // Every non-trigger node is reachable from at least one edge
    const targetIds = new Set(create.edges!.map((e) => e.target));
    const triggerIds = new Set(create.nodes!.filter((n) => n.type === "cron").map((n) => n.id));
    for (const node of create.nodes!) {
      if (!triggerIds.has(node.id)) {
        expect(targetIds.has(node.id)).toBe(true);
      }
    }
  });

  it("empty window produces correct output shape", async () => {
    const ctx: ExecutorContext = {
      callGatewayRpc: vi
        .fn()
        .mockResolvedValueOnce({ runs: [{ completedAtMs: Date.now() - 3600000 }] })
        .mockResolvedValueOnce({ messages: [] }),
      log: { info: vi.fn(), error: vi.fn() },
    };

    const pipelineCreate = buildSlackDigestPipelineCreate();
    const fetchNode = pipelineCreate.nodes!.find((n) => n.id === "fetch-messages")!;

    const result = await executeFetchMessages(fetchNode, undefined, ctx);

    expect(result.status).toBe("success");
    const output = result.output as Record<string, unknown>;
    expect(output.empty).toBe(true);
    expect(output.messageCount).toBe(0);
    expect(output.channels).toEqual([]);
  });
});
