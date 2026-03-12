// ---------------------------------------------------------------------------
// Slack Digest Pipeline — Built-in Pipeline Definition Factory
// ---------------------------------------------------------------------------

import type { PipelineService } from "../service.js";
import type { PipelineCreate, PipelineNode, PipelineEdge } from "../types.js";
import { SUMMARIZE_PROMPT, VAULT_AND_FORMAT_PROMPT } from "./slack-digest-prompts.js";

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const SLACK_DIGEST_PIPELINE_ID = "builtin:slack-digest";

// ===========================================================================
// FACTORY
// ===========================================================================

export function buildSlackDigestPipelineCreate(): PipelineCreate {
  const nodes: PipelineNode[] = [
    // -------------------------------------------------------------------------
    // Trigger: noon cron (12:00 Sydney)
    // -------------------------------------------------------------------------
    {
      id: "cron-noon",
      type: "cron",
      label: "Noon Trigger",
      config: {
        schedule: "0 12 * * *",
        timezone: "Australia/Sydney",
      },
      position: { x: 0, y: 0 },
      state: { status: "idle" as const, retryCount: 0 },
    },

    // -------------------------------------------------------------------------
    // Trigger: evening cron (19:00 Sydney)
    // -------------------------------------------------------------------------
    {
      id: "cron-evening",
      type: "cron",
      label: "Evening Trigger",
      config: {
        schedule: "0 19 * * *",
        timezone: "Australia/Sydney",
      },
      position: { x: 0, y: 120 },
      state: { status: "idle" as const, retryCount: 0 },
    },

    // -------------------------------------------------------------------------
    // Code: fetch-messages
    // -------------------------------------------------------------------------
    {
      id: "fetch-messages",
      type: "code",
      label: "Fetch Slack Messages",
      config: {
        description: "slack-digest:fetch-messages",
      },
      position: { x: 250, y: 60 },
      state: { status: "idle" as const, retryCount: 0 },
    },

    // -------------------------------------------------------------------------
    // Agent: summarize
    // -------------------------------------------------------------------------
    {
      id: "summarize",
      type: "agent",
      label: "Summarize Messages",
      config: {
        prompt: SUMMARIZE_PROMPT,
        model: "openai/gpt-5.2",
        session: "isolated",
        timeout: 300,
      },
      position: { x: 500, y: 60 },
      state: { status: "idle" as const, retryCount: 0 },
    },

    // -------------------------------------------------------------------------
    // Agent: vault-format
    // -------------------------------------------------------------------------
    {
      id: "vault-format",
      type: "agent",
      label: "Vault & Format",
      config: {
        prompt: VAULT_AND_FORMAT_PROMPT,
        model: "openai/gpt-4.1-mini",
        session: "isolated",
        timeout: 180,
        tools: ["vault"],
      },
      position: { x: 750, y: 60 },
      state: { status: "idle" as const, retryCount: 0 },
    },

    // -------------------------------------------------------------------------
    // Notify: dispatch via Telegram
    // -------------------------------------------------------------------------
    {
      id: "dispatch",
      type: "notify",
      label: "Send Telegram Notification",
      config: {
        channels: ["telegram"],
        message: "{{input.result.payloads.0.text}}",
        priority: "medium",
      },
      position: { x: 1000, y: 60 },
      state: { status: "idle" as const, retryCount: 0 },
    },
  ];

  const edges: PipelineEdge[] = [
    { id: "sd-e1", source: "cron-noon", target: "fetch-messages" },
    { id: "sd-e2", source: "cron-evening", target: "fetch-messages" },
    { id: "sd-e3", source: "fetch-messages", target: "summarize" },
    { id: "sd-e4", source: "summarize", target: "vault-format" },
    { id: "sd-e5", source: "vault-format", target: "dispatch" },
  ];

  return {
    id: SLACK_DIGEST_PIPELINE_ID,
    name: "Slack Channel Digest",
    description:
      "Twice-daily Slack digest: fetches messages, summarizes with AI, writes vault notes, and sends Telegram notification.",
    enabled: true,
    builtIn: true,
    nodes,
    edges,
  };
}

// ===========================================================================
// ENSURE (IDEMPOTENT)
// ===========================================================================

/**
 * Ensures the Slack digest pipeline exists in the store.
 * If it already exists, does nothing. Otherwise creates it.
 *
 * @returns `{ created: true }` if the pipeline was created, `{ created: false }` if it already existed.
 */
export async function ensureSlackDigestPipeline(
  service: PipelineService,
): Promise<{ created: boolean }> {
  const existing = await service.get(SLACK_DIGEST_PIPELINE_ID);
  if (existing) {
    return { created: false };
  }

  await service.create(buildSlackDigestPipelineCreate());
  return { created: true };
}
