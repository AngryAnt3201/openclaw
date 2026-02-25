/**
 * Default "Coder" agent — a built-in orchestrator that ships with Miranda.
 *
 * This agent does not write code directly; it spawns and manages Maestro
 * (Claude Code) sessions to accomplish coding tasks.  It uses the internal
 * task system for progress tracking and input collection, and operates
 * autonomously by default.
 */

export const CODER_AGENT_ID = "coder" as const;

/** Shape stored alongside each built-in agent definition. */
export interface BuiltInAgentDef {
  /** Stable agent identifier (used as config key). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description shown in the UI. */
  description: string;
  /** Emoji icon for quick identification. */
  icon: string;
  /** Theme colour key (maps to AGENT_COLORS on the frontend). */
  color: string;
  /** Default model reference (provider/model). */
  model: string;
  /** Task-policy preset. */
  policyPreset: string;
  /** Extended-thinking budget level. */
  thinking: string;
  /** Default tool allowlist. */
  tools: string[];
  /** Sub-agent spawning policy. */
  subagents: { allowAgents: string[] };
  /** Sandbox mode override. */
  sandbox: string;
  /** Whether this is the default agent users interact with. */
  default?: boolean;
}

export const CODER_AGENT_DEF: BuiltInAgentDef = {
  id: CODER_AGENT_ID,
  name: "Coder",
  description:
    "Orchestrator agent that spawns and manages Maestro coding sessions to accomplish tasks autonomously.",
  icon: "\u26A1", // ⚡
  color: "cyan",
  model: "anthropic/claude-sonnet-4-5",
  policyPreset: "coding",
  thinking: "high",
  tools: ["maestro_session", "task", "github", "pipeline", "nodes", "web_search", "web_fetch"],
  subagents: { allowAgents: ["*"] },
  sandbox: "off",
};
