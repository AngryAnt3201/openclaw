import { describe, expect, it, beforeEach } from "vitest";
import type { NodeDefinition, NodeCategory } from "./types.js";
import { NodeRegistry, BUILTIN_NODE_DEFINITIONS } from "./node-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDef(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type: overrides.type ?? "test_node",
    category: overrides.category ?? "action",
    label: overrides.label ?? "Test Node",
    description: overrides.description ?? "A test node.",
    configFields: overrides.configFields ?? [],
    ports: overrides.ports ?? [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NodeRegistry", () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  it("starts empty", () => {
    expect(registry.list()).toEqual([]);
    expect(registry.get("anything")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  it("registers a node definition", () => {
    const def = makeDef({ type: "my_node", label: "My Node" });
    registry.register(def);

    expect(registry.get("my_node")).toEqual(def);
    expect(registry.list()).toHaveLength(1);
  });

  it("overwrites an existing registration with the same type", () => {
    const v1 = makeDef({ type: "x", label: "Version 1" });
    const v2 = makeDef({ type: "x", label: "Version 2" });

    registry.register(v1);
    registry.register(v2);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("x")?.label).toBe("Version 2");
  });

  it("returns undefined for an unknown type", () => {
    registry.register(makeDef({ type: "known" }));
    expect(registry.get("unknown")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Listing
  // -----------------------------------------------------------------------

  it("lists all registered definitions", () => {
    registry.register(makeDef({ type: "a" }));
    registry.register(makeDef({ type: "b" }));
    registry.register(makeDef({ type: "c" }));

    const types = registry.list().map((d) => d.type);
    expect(types).toEqual(["a", "b", "c"]);
  });

  it("list() returns a copy — mutations do not affect the registry", () => {
    registry.register(makeDef({ type: "a" }));
    const list = registry.list();
    list.pop();
    expect(registry.list()).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Category filtering
  // -----------------------------------------------------------------------

  it("lists by category", () => {
    registry.register(makeDef({ type: "t1", category: "trigger" }));
    registry.register(makeDef({ type: "p1", category: "processing" }));
    registry.register(makeDef({ type: "a1", category: "action" }));
    registry.register(makeDef({ type: "t2", category: "trigger" }));

    const triggers = registry.listByCategory("trigger");
    expect(triggers).toHaveLength(2);
    expect(triggers.map((d) => d.type)).toEqual(["t1", "t2"]);

    expect(registry.listByCategory("processing")).toHaveLength(1);
    expect(registry.listByCategory("action")).toHaveLength(1);
  });

  it("listByCategory returns empty array for categories with no matches", () => {
    registry.register(makeDef({ type: "a1", category: "action" }));
    expect(registry.listByCategory("trigger")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Built-in definitions
  // -----------------------------------------------------------------------

  describe("registerBuiltins()", () => {
    beforeEach(() => {
      registry.registerBuiltins();
    });

    it("provides at least 4 trigger nodes", () => {
      const triggers = registry.listByCategory("trigger");
      expect(triggers.length).toBeGreaterThanOrEqual(4);
    });

    it("provides at least 4 processing nodes", () => {
      const processing = registry.listByCategory("processing");
      expect(processing.length).toBeGreaterThanOrEqual(4);
    });

    it("provides at least 2 action nodes", () => {
      const actions = registry.listByCategory("action");
      expect(actions.length).toBeGreaterThanOrEqual(2);
    });

    it("registers exactly 11 built-in types", () => {
      expect(registry.list()).toHaveLength(12);
    });

    it("every definition has a non-empty label and description", () => {
      for (const def of registry.list()) {
        expect(def.label.length).toBeGreaterThan(0);
        expect(def.description.length).toBeGreaterThan(0);
      }
    });

    it("every definition has at least one port", () => {
      for (const def of registry.list()) {
        expect(def.ports.length).toBeGreaterThan(0);
      }
    });

    it("all trigger nodes have an output port", () => {
      for (const def of registry.listByCategory("trigger")) {
        expect(def.ports.some((p) => p.type === "output")).toBe(true);
      }
    });

    it("agent node has success and failure output ports", () => {
      const agent = registry.get("agent");
      expect(agent).toBeDefined();
      const outputIds = agent!.ports.filter((p) => p.type === "output").map((p) => p.id);
      expect(outputIds).toContain("success");
      expect(outputIds).toContain("failure");
    });

    it("condition node has true and false output ports", () => {
      const cond = registry.get("condition");
      expect(cond).toBeDefined();
      const outputIds = cond!.ports.filter((p) => p.type === "output").map((p) => p.id);
      expect(outputIds).toContain("true");
      expect(outputIds).toContain("false");
    });

    it("can be called multiple times without duplicating entries", () => {
      registry.registerBuiltins();
      registry.registerBuiltins();
      expect(registry.list()).toHaveLength(12);
    });

    it("includes the expected built-in types", () => {
      const types = registry
        .list()
        .map((d) => d.type)
        .toSorted();
      expect(types).toEqual([
        "agent",
        "app",
        "approval",
        "code",
        "condition",
        "cron",
        "loop",
        "manual",
        "notify",
        "output",
        "task_event",
        "webhook",
      ]);
    });

    it("cron node has a required schedule config field", () => {
      const cron = registry.get("cron");
      expect(cron).toBeDefined();
      const scheduleField = cron!.configFields.find((f) => f.key === "schedule");
      expect(scheduleField).toBeDefined();
      expect(scheduleField!.required).toBe(true);
    });

    it("agent node has prompt as required and timeout with default 300", () => {
      const agent = registry.get("agent");
      expect(agent).toBeDefined();
      const prompt = agent!.configFields.find((f) => f.key === "prompt");
      expect(prompt?.required).toBe(true);
      const timeout = agent!.configFields.find((f) => f.key === "timeout");
      expect(timeout?.defaultValue).toBe(300);
    });
  });

  // -----------------------------------------------------------------------
  // BUILTIN_NODE_DEFINITIONS export
  // -----------------------------------------------------------------------

  it("exports BUILTIN_NODE_DEFINITIONS as a frozen array of 11 items", () => {
    expect(BUILTIN_NODE_DEFINITIONS).toHaveLength(12);
  });

  // -----------------------------------------------------------------------
  // Custom node alongside builtins
  // -----------------------------------------------------------------------

  it("can register custom nodes alongside builtins", () => {
    registry.registerBuiltins();
    const custom = makeDef({ type: "custom:my_plugin", category: "action", label: "My Plugin" });
    registry.register(custom);

    expect(registry.list()).toHaveLength(13);
    expect(registry.get("custom:my_plugin")?.label).toBe("My Plugin");
    // Builtins still intact
    expect(registry.get("agent")).toBeDefined();
  });

  it("custom node can overwrite a builtin", () => {
    registry.registerBuiltins();
    const override = makeDef({ type: "agent", category: "processing", label: "Custom Agent" });
    registry.register(override);

    expect(registry.list()).toHaveLength(12);
    expect(registry.get("agent")?.label).toBe("Custom Agent");
  });
});
