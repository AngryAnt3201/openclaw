import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineService } from "../service.js";
import {
  buildSlackDigestPipelineCreate,
  ensureSlackDigestPipeline,
  SLACK_DIGEST_PIPELINE_ID,
} from "./slack-digest-pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-slack-digest-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function makeService(storePath: string) {
  return new PipelineService({ storePath });
}

// ---------------------------------------------------------------------------
// buildSlackDigestPipelineCreate
// ---------------------------------------------------------------------------

describe("buildSlackDigestPipelineCreate", () => {
  it("returns a valid PipelineCreate with correct id", () => {
    const pc = buildSlackDigestPipelineCreate();

    expect(pc.id).toBe(SLACK_DIGEST_PIPELINE_ID);
    expect(pc.id).toBe("builtin:slack-digest");
    expect(pc.name).toBe("Slack Channel Digest");
    expect(pc.enabled).toBe(true);
    expect(pc.builtIn).toBe(true);
    expect(pc.nodes).toBeDefined();
    expect(pc.edges).toBeDefined();
  });

  it("has two cron trigger nodes with correct schedules", () => {
    const pc = buildSlackDigestPipelineCreate();
    const nodes = pc.nodes ?? [];

    const cronNoon = nodes.find((n) => n.id === "cron-noon");
    const cronEvening = nodes.find((n) => n.id === "cron-evening");

    expect(cronNoon).toBeDefined();
    expect(cronNoon?.type).toBe("cron");
    expect((cronNoon?.config as { schedule: string; timezone: string }).schedule).toBe(
      "0 12 * * *",
    );
    expect((cronNoon?.config as { schedule: string; timezone: string }).timezone).toBe(
      "Australia/Sydney",
    );

    expect(cronEvening).toBeDefined();
    expect(cronEvening?.type).toBe("cron");
    expect((cronEvening?.config as { schedule: string; timezone: string }).schedule).toBe(
      "0 19 * * *",
    );
    expect((cronEvening?.config as { schedule: string; timezone: string }).timezone).toBe(
      "Australia/Sydney",
    );
  });

  it("has fetch → summarize → vault-format → notify flow with edge ids", () => {
    const pc = buildSlackDigestPipelineCreate();
    const edges = pc.edges ?? [];
    const nodes = pc.nodes ?? [];

    // All edges must have an id
    for (const edge of edges) {
      expect(edge.id).toBeTruthy();
    }

    // Check expected edge IDs exist
    const edgeIds = edges.map((e) => e.id);
    expect(edgeIds).toContain("sd-e1");
    expect(edgeIds).toContain("sd-e2");
    expect(edgeIds).toContain("sd-e3");
    expect(edgeIds).toContain("sd-e4");
    expect(edgeIds).toContain("sd-e5");

    // Check the flow: cron-noon → fetch-messages
    const e1 = edges.find((e) => e.id === "sd-e1");
    expect(e1?.source).toBe("cron-noon");
    expect(e1?.target).toBe("fetch-messages");

    // cron-evening → fetch-messages
    const e2 = edges.find((e) => e.id === "sd-e2");
    expect(e2?.source).toBe("cron-evening");
    expect(e2?.target).toBe("fetch-messages");

    // fetch-messages → summarize
    const e3 = edges.find((e) => e.id === "sd-e3");
    expect(e3?.source).toBe("fetch-messages");
    expect(e3?.target).toBe("summarize");

    // summarize → vault-format
    const e4 = edges.find((e) => e.id === "sd-e4");
    expect(e4?.source).toBe("summarize");
    expect(e4?.target).toBe("vault-format");

    // vault-format → dispatch
    const e5 = edges.find((e) => e.id === "sd-e5");
    expect(e5?.source).toBe("vault-format");
    expect(e5?.target).toBe("dispatch");

    // Verify node types
    const fetchNode = nodes.find((n) => n.id === "fetch-messages");
    expect(fetchNode?.type).toBe("code");

    const summarizeNode = nodes.find((n) => n.id === "summarize");
    expect(summarizeNode?.type).toBe("agent");

    const vaultFormatNode = nodes.find((n) => n.id === "vault-format");
    expect(vaultFormatNode?.type).toBe("agent");

    const dispatchNode = nodes.find((n) => n.id === "dispatch");
    expect(dispatchNode?.type).toBe("notify");
  });

  it("summarize node uses isolated session", () => {
    const pc = buildSlackDigestPipelineCreate();
    const nodes = pc.nodes ?? [];

    const summarize = nodes.find((n) => n.id === "summarize");
    expect(summarize).toBeDefined();
    expect(summarize?.type).toBe("agent");

    const config = summarize?.config as {
      session: string;
      model: string;
      timeout: number;
      prompt: string;
    };
    expect(config.session).toBe("isolated");
    expect(config.model).toBe("anthropic/claude-sonnet-4-5");
    expect(config.timeout).toBe(300);
    expect(typeof config.prompt).toBe("string");
    expect(config.prompt.length).toBeGreaterThan(0);
  });

  it("vault-format node has vault tool access", () => {
    const pc = buildSlackDigestPipelineCreate();
    const nodes = pc.nodes ?? [];

    const vaultFormat = nodes.find((n) => n.id === "vault-format");
    expect(vaultFormat).toBeDefined();
    expect(vaultFormat?.type).toBe("agent");

    const config = vaultFormat?.config as {
      session: string;
      model: string;
      timeout: number;
      tools: string[];
      prompt: string;
    };
    expect(config.session).toBe("isolated");
    expect(config.model).toBe("anthropic/claude-haiku-4-5");
    expect(config.timeout).toBe(180);
    expect(Array.isArray(config.tools)).toBe(true);
    expect(config.tools).toContain("vault");
    expect(typeof config.prompt).toBe("string");
    expect(config.prompt.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSlackDigestPipeline
// ---------------------------------------------------------------------------

describe("ensureSlackDigestPipeline", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates pipeline if not exists", async () => {
    const service = makeService(storePath);

    const result = await ensureSlackDigestPipeline(service);
    expect(result.created).toBe(true);

    // Verify it actually exists in the store
    const pipeline = await service.get(SLACK_DIGEST_PIPELINE_ID);
    expect(pipeline).not.toBeNull();
    expect(pipeline?.id).toBe(SLACK_DIGEST_PIPELINE_ID);
    expect(pipeline?.name).toBe("Slack Channel Digest");
    expect(pipeline?.builtIn).toBe(true);
  });

  it("skips creation if pipeline already exists", async () => {
    const service = makeService(storePath);

    // Create it the first time
    const first = await ensureSlackDigestPipeline(service);
    expect(first.created).toBe(true);

    // Attempt to create again — should be a no-op
    const second = await ensureSlackDigestPipeline(service);
    expect(second.created).toBe(false);

    // Only one pipeline should exist
    const all = await service.list();
    const digests = all.filter((p) => p.id === SLACK_DIGEST_PIPELINE_ID);
    expect(digests).toHaveLength(1);
  });
});
