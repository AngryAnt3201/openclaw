/**
 * Built-in agent registry.
 *
 * Ships default agents that are always present in Miranda.  Users can
 * customise their config (model, skills, etc.) but cannot delete them.
 */

import type { OpenClawConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { CODER_AGENT_DEF, CODER_AGENT_ID, type BuiltInAgentDef } from "./coder-agent.js";
import { MIRANDA_AGENT_DEF, MIRANDA_AGENT_ID } from "./miranda-agent.js";

export { CODER_AGENT_DEF, CODER_AGENT_ID, type BuiltInAgentDef } from "./coder-agent.js";
export { CODER_SOUL_CONTENT } from "./coder-soul.js";
export { MIRANDA_AGENT_DEF, MIRANDA_AGENT_ID } from "./miranda-agent.js";
export { MIRANDA_SOUL_CONTENT } from "./miranda-soul.js";

// ── Registry ──────────────────────────────────────────────────────────────

const REGISTRY: ReadonlyMap<string, BuiltInAgentDef> = new Map<string, BuiltInAgentDef>([
  [MIRANDA_AGENT_ID, MIRANDA_AGENT_DEF],
  [CODER_AGENT_ID, CODER_AGENT_DEF],
]);

/** All registered built-in agents (keyed by normalised id). */
export const BUILTIN_AGENTS: ReadonlyMap<string, BuiltInAgentDef> = REGISTRY;

/** Set of built-in agent IDs for quick membership tests. */
export const BUILTIN_AGENT_IDS: ReadonlySet<string> = new Set(REGISTRY.keys());

// ── Helpers ───────────────────────────────────────────────────────────────

/** Returns `true` when `id` matches a built-in agent (case-insensitive). */
export function isBuiltInAgent(id: string): boolean {
  return BUILTIN_AGENT_IDS.has(normalizeAgentId(id));
}

/** Retrieve the built-in definition for `id`, or `undefined`. */
export function getBuiltInAgentConfig(id: string): BuiltInAgentDef | undefined {
  return REGISTRY.get(normalizeAgentId(id));
}

/** List all built-in agent definitions. */
export function listBuiltInAgents(): BuiltInAgentDef[] {
  return Array.from(REGISTRY.values());
}

// ── Config Merge ──────────────────────────────────────────────────────────

/**
 * Ensure every built-in agent exists in `cfg.agents.list`.
 *
 * - If the agent is already present, its entry is left untouched (user
 *   overrides are preserved).
 * - If absent, a minimal entry is inserted with the built-in defaults.
 *
 * Returns a **new** config object; never mutates the input.  The boolean
 * `changed` flag tells callers whether the config needs to be persisted.
 */
export function ensureBuiltInAgents(cfg: OpenClawConfig): {
  config: OpenClawConfig;
  changed: boolean;
} {
  const existingList = cfg.agents?.list ?? [];
  const existingIds = new Set(
    existingList
      .filter((e): e is NonNullable<typeof e> => Boolean(e?.id))
      .map((e) => normalizeAgentId(e.id)),
  );

  let changed = false;
  const additions: NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]> = [];

  for (const [id, def] of REGISTRY) {
    if (existingIds.has(id)) {
      continue;
    }
    additions.push({
      id: def.id,
      default: def.default ?? false,
      name: def.name,
      model: def.model,
      identity: {
        name: def.name,
        emoji: def.icon,
      },
      tools: {
        allow: def.tools,
      },
    });
    changed = true;
  }

  if (!changed) {
    return { config: cfg, changed: false };
  }

  return {
    config: {
      ...cfg,
      agents: {
        ...cfg.agents,
        list: [...existingList, ...additions],
      },
    },
    changed: true,
  };
}
