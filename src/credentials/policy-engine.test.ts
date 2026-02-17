import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { PermissionRule } from "./types.js";
import { compileRule, evaluateRules } from "./policy-engine.js";

function makeRule(text: string, enabled = true): PermissionRule {
  return {
    id: randomUUID(),
    text,
    compiledConstraints: compileRule(text),
    createdAtMs: Date.now(),
    enabled,
  };
}

describe("Policy Engine", () => {
  describe("compileRule", () => {
    it("should compile read-only rule", () => {
      const constraints = compileRule("Read only");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("action_restriction");
      expect(constraints[0]!.actions).toContain("read");
    });

    it("should compile tool denylist", () => {
      const constraints = compileRule("No browser access");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("tool_denylist");
      expect(constraints[0]!.tools).toContain("browser");
    });

    it("should compile tool allowlist", () => {
      const constraints = compileRule("Only allow browser and code");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("tool_allowlist");
      expect(constraints[0]!.tools).toContain("browser");
      expect(constraints[0]!.tools).toContain("code");
    });

    it("should compile rate limit per minute", () => {
      const constraints = compileRule("Max 10 per minute");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("rate_limit");
      expect(constraints[0]!.maxPerMinute).toBe(10);
    });

    it("should compile rate limit per hour", () => {
      const constraints = compileRule("Limit 100 per hour");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("rate_limit");
      expect(constraints[0]!.maxPerHour).toBe(100);
    });

    it("should compile time window", () => {
      const constraints = compileRule("Between 9 and 17 UTC");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("time_window");
      expect(constraints[0]!.allowedHoursUtc).toEqual({ start: 9, end: 17 });
    });

    it("should compile business hours", () => {
      const constraints = compileRule("Business hours only");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("time_window");
      expect(constraints[0]!.allowedHoursUtc).toEqual({ start: 9, end: 17 });
    });

    it("should compile purpose restriction", () => {
      const constraints = compileRule("For research only");
      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.type).toBe("purpose_restriction");
      expect(constraints[0]!.purposes).toContain("research");
    });

    it("should return empty for unrecognized text", () => {
      const constraints = compileRule("hello world");
      expect(constraints).toHaveLength(0);
    });

    it("should compile multiple constraints", () => {
      const constraints = compileRule("Read only. No browser access.");
      expect(constraints.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("evaluateRules", () => {
    it("should allow when no rules", () => {
      const result = evaluateRules([], { toolName: "browser" });
      expect(result.allowed).toBe(true);
      expect(result.matchedRules).toHaveLength(0);
    });

    it("should block denied tool", () => {
      const rules = [makeRule("No browser access")];
      const result = evaluateRules(rules, { toolName: "browser" });
      expect(result.allowed).toBe(false);
      expect(result.matchedRules).toHaveLength(1);
    });

    it("should allow non-denied tool", () => {
      const rules = [makeRule("No browser access")];
      const result = evaluateRules(rules, { toolName: "exec" });
      expect(result.allowed).toBe(true);
    });

    it("should skip disabled rules", () => {
      const rules = [makeRule("No browser access", false)];
      const result = evaluateRules(rules, { toolName: "browser" });
      expect(result.allowed).toBe(true);
    });

    it("should block tool not in allowlist", () => {
      const rules = [makeRule("Only allow code")];
      const result = evaluateRules(rules, { toolName: "browser" });
      expect(result.allowed).toBe(false);
    });

    it("should allow tool in allowlist", () => {
      const rules = [makeRule("Only allow code")];
      const result = evaluateRules(rules, { toolName: "code" });
      expect(result.allowed).toBe(true);
    });

    it("should enforce time window", () => {
      const rules = [makeRule("Between 9 and 17 UTC")];
      // Create a timestamp at 3am UTC → should be blocked
      const ts = new Date("2024-01-15T03:00:00Z").getTime();
      const result = evaluateRules(rules, { timestampMs: ts });
      expect(result.allowed).toBe(false);

      // Create a timestamp at 12pm UTC → should be allowed
      const ts2 = new Date("2024-01-15T12:00:00Z").getTime();
      const result2 = evaluateRules(rules, { timestampMs: ts2 });
      expect(result2.allowed).toBe(true);
    });
  });
});
