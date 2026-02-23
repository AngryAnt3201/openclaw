import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  BUILTIN_AGENTS,
  BUILTIN_AGENT_IDS,
  CODER_AGENT_DEF,
  CODER_AGENT_ID,
  MIRANDA_AGENT_DEF,
  MIRANDA_AGENT_ID,
  ensureBuiltInAgents,
  getBuiltInAgentConfig,
  isBuiltInAgent,
  listBuiltInAgents,
} from "./index.js";

describe("isBuiltInAgent", () => {
  it("returns true for 'coder'", () => {
    expect(isBuiltInAgent("coder")).toBe(true);
  });

  it("returns true for 'Coder' (case-insensitive)", () => {
    expect(isBuiltInAgent("Coder")).toBe(true);
  });

  it("returns true for 'miranda'", () => {
    expect(isBuiltInAgent("miranda")).toBe(true);
  });

  it("returns true for 'Miranda' (case-insensitive)", () => {
    expect(isBuiltInAgent("Miranda")).toBe(true);
  });

  it("returns false for a custom agent", () => {
    expect(isBuiltInAgent("custom-agent")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isBuiltInAgent("")).toBe(false);
  });
});

describe("getBuiltInAgentConfig", () => {
  it("returns the coder definition", () => {
    const def = getBuiltInAgentConfig("coder");
    expect(def).toBeDefined();
    expect(def?.id).toBe("coder");
    expect(def?.name).toBe("Coder");
    expect(def?.color).toBe("cyan");
  });

  it("returns the miranda definition", () => {
    const def = getBuiltInAgentConfig("miranda");
    expect(def).toBeDefined();
    expect(def?.id).toBe("miranda");
    expect(def?.name).toBe("Miranda");
    expect(def?.color).toBe("violet");
  });

  it("returns undefined for unknown id", () => {
    expect(getBuiltInAgentConfig("unknown")).toBeUndefined();
  });
});

describe("listBuiltInAgents", () => {
  it("returns both miranda and coder agents", () => {
    const list = listBuiltInAgents();
    expect(list.length).toBe(2);
    expect(list.some((a) => a.id === "coder")).toBe(true);
    expect(list.some((a) => a.id === "miranda")).toBe(true);
  });
});

describe("BUILTIN_AGENTS / BUILTIN_AGENT_IDS", () => {
  it("map contains coder", () => {
    expect(BUILTIN_AGENTS.has("coder")).toBe(true);
  });

  it("map contains miranda", () => {
    expect(BUILTIN_AGENTS.has("miranda")).toBe(true);
  });

  it("set contains coder", () => {
    expect(BUILTIN_AGENT_IDS.has("coder")).toBe(true);
  });

  it("set contains miranda", () => {
    expect(BUILTIN_AGENT_IDS.has("miranda")).toBe(true);
  });
});

describe("ensureBuiltInAgents", () => {
  it("adds both miranda and coder to empty config", () => {
    const cfg: OpenClawConfig = {};
    const { config, changed } = ensureBuiltInAgents(cfg);
    expect(changed).toBe(true);
    const list = config.agents?.list ?? [];
    expect(list.length).toBe(2);
    const miranda = list.find((a) => a.id === "miranda");
    const coder = list.find((a) => a.id === "coder");
    expect(miranda).toBeDefined();
    expect(miranda?.name).toBe("Miranda");
    expect(miranda?.default).toBe(true);
    expect(coder).toBeDefined();
    expect(coder?.name).toBe("Coder");
    expect(coder?.default).toBe(false);
  });

  it("adds missing built-ins when agents.list has custom agents only", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "my-agent", name: "My Agent" }],
      },
    };
    const { config, changed } = ensureBuiltInAgents(cfg);
    expect(changed).toBe(true);
    const list = config.agents?.list ?? [];
    expect(list.length).toBe(3);
    expect(list[0]?.id).toBe("my-agent");
    expect(list.some((a) => a.id === "miranda")).toBe(true);
    expect(list.some((a) => a.id === "coder")).toBe(true);
  });

  it("preserves user overrides when both built-ins already exist", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [
          { id: "miranda", name: "My Miranda", model: "openai/gpt-4o" },
          { id: "coder", name: "My Custom Coder", model: "openai/gpt-4o" },
        ],
      },
    };
    const { config, changed } = ensureBuiltInAgents(cfg);
    expect(changed).toBe(false);
    expect(config).toBe(cfg); // same reference — no mutation
    const list = config.agents?.list ?? [];
    expect(list.length).toBe(2);
    expect(list[0]?.name).toBe("My Miranda");
    expect(list[1]?.name).toBe("My Custom Coder");
  });

  it("handles config with empty agents.list", () => {
    const cfg: OpenClawConfig = {
      agents: { list: [] },
    };
    const { config, changed } = ensureBuiltInAgents(cfg);
    expect(changed).toBe(true);
    expect(config.agents?.list?.length).toBe(2);
  });

  it("injects tool allowlist for auto-created agents", () => {
    const cfg: OpenClawConfig = {};
    const { config } = ensureBuiltInAgents(cfg);
    const list = config.agents?.list ?? [];
    const miranda = list.find((a) => a.id === "miranda");
    expect(miranda?.tools?.allow).toEqual(MIRANDA_AGENT_DEF.tools);
    const coder = list.find((a) => a.id === "coder");
    expect(coder?.tools?.allow).toEqual(CODER_AGENT_DEF.tools);
  });

  it("only adds missing built-in when one already exists", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "miranda", name: "Miranda" }],
      },
    };
    const { config, changed } = ensureBuiltInAgents(cfg);
    expect(changed).toBe(true);
    const list = config.agents?.list ?? [];
    expect(list.length).toBe(2);
    expect(list[0]?.id).toBe("miranda");
    expect(list[1]?.id).toBe("coder");
  });
});

describe("CODER_AGENT_DEF", () => {
  it("has expected structure", () => {
    expect(CODER_AGENT_DEF.id).toBe(CODER_AGENT_ID);
    expect(CODER_AGENT_DEF.tools).toContain("maestro_session");
    expect(CODER_AGENT_DEF.tools).toContain("task");
    expect(CODER_AGENT_DEF.policyPreset).toBe("coding");
    expect(CODER_AGENT_DEF.thinking).toBe("high");
    expect(CODER_AGENT_DEF.sandbox).toBe("off");
    expect(CODER_AGENT_DEF.default).toBeUndefined();
  });
});

describe("MIRANDA_AGENT_DEF", () => {
  it("has expected structure", () => {
    expect(MIRANDA_AGENT_DEF.id).toBe(MIRANDA_AGENT_ID);
    expect(MIRANDA_AGENT_DEF.name).toBe("Miranda");
    expect(MIRANDA_AGENT_DEF.icon).toBe("\uD83C\uDF19"); // 🌙
    expect(MIRANDA_AGENT_DEF.color).toBe("violet");
    expect(MIRANDA_AGENT_DEF.model).toBe("anthropic/claude-sonnet-4-5");
    expect(MIRANDA_AGENT_DEF.policyPreset).toBe("full");
    expect(MIRANDA_AGENT_DEF.thinking).toBe("medium");
    expect(MIRANDA_AGENT_DEF.sandbox).toBe("off");
    expect(MIRANDA_AGENT_DEF.default).toBe(true);
  });

  it("has no code-editing tools", () => {
    const codingTools = [
      "read",
      "write",
      "edit",
      "exec",
      "apply_patch",
      "grep",
      "find",
      "ls",
      "process",
    ];
    for (const tool of codingTools) {
      expect(MIRANDA_AGENT_DEF.tools).not.toContain(tool);
    }
  });

  it("can invoke coder sub-agent", () => {
    expect(MIRANDA_AGENT_DEF.subagents.allowAgents).toContain("coder");
  });
});
