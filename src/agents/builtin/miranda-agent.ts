/**
 * Default "Miranda" agent — the primary general-purpose assistant.
 *
 * Miranda handles research, planning, conversation, task management,
 * messaging, and coordination.  She delegates coding work to the Coder
 * sub-agent via session spawning.
 */

import type { BuiltInAgentDef } from "./coder-agent.js";

export const MIRANDA_AGENT_ID = "miranda" as const;

export const MIRANDA_AGENT_DEF: BuiltInAgentDef = {
  id: MIRANDA_AGENT_ID,
  name: "Miranda",
  description:
    "General-purpose assistant for research, planning, conversation, and task coordination. Delegates coding to the Coder sub-agent.",
  icon: "\uD83C\uDF19", // 🌙
  color: "violet",
  model: "anthropic/claude-sonnet-4-5",
  policyPreset: "full",
  thinking: "medium",
  tools: [
    "web_search",
    "web_fetch",
    "browser",
    "message",
    "vault",
    "task",
    "cron",
    "credential",
    "pipeline",
    "sessions_spawn",
    "sessions_list",
    "sessions_send",
    "agents_list",
    "nodes",
    "image",
    "tts",
    "group",
  ],
  subagents: { allowAgents: ["coder", "architect"] },
  sandbox: "off",
  default: true,
};
