/**
 * Built-in "Architect" agent — automation designer and pipeline builder.
 *
 * The Architect iterates with users to understand automation goals, designs
 * pipeline graphs for the flow editor, sets up credentials and cron schedules,
 * generates custom code for nodes, and delegates complex code work to Coder.
 */

import type { BuiltInAgentDef } from "./coder-agent.js";

export const ARCHITECT_AGENT_ID = "architect" as const;

export const ARCHITECT_AGENT_DEF: BuiltInAgentDef = {
  id: ARCHITECT_AGENT_ID,
  name: "The Architect",
  description:
    "Automation designer that builds pipelines through conversation. Designs flow editor graphs, sets up credentials, creates cron schedules, and generates custom code for nodes.",
  icon: "\uD83D\uDD27", // 🔧
  color: "amber",
  model: "anthropic/claude-opus-4-6",
  policyPreset: "full",
  thinking: "high",
  tools: [
    "pipeline",
    "task",
    "cron",
    "credential",
    "execute_code",
    "maestro_session",
    "web_search",
    "web_fetch",
    "browser",
    "widget",
    "agents_list",
    "nodes",
    "github",
    "message",
  ],
  subagents: { allowAgents: ["coder", "*"] },
  sandbox: "off",
  default: true,
};
