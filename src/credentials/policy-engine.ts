// ---------------------------------------------------------------------------
// Credential Policy Engine – Rule compilation & evaluation
// ---------------------------------------------------------------------------
// Compiles natural-language rule text into structured constraints via
// deterministic keyword extraction (no LLM). Evaluates constraints against
// checkout context at runtime.
// ---------------------------------------------------------------------------

import type { CompiledConstraint, ConstraintType, PermissionRule } from "./types.js";

// ---------------------------------------------------------------------------
// Checkout context (passed in at evaluation time)
// ---------------------------------------------------------------------------

export type PolicyCheckContext = {
  toolName?: string;
  action?: string;
  agentId?: string;
  taskId?: string;
  timestampMs?: number;
};

export type PolicyEvalResult = {
  allowed: boolean;
  reason?: string;
  matchedRules: string[];
};

// ---------------------------------------------------------------------------
// Rule compilation (text → constraints)
// ---------------------------------------------------------------------------

const TOOL_PATTERNS: Record<string, string[]> = {
  browser: ["browser", "navigate", "web", "browse"],
  exec: ["exec", "execute", "command", "shell", "terminal", "run"],
  message: ["message", "send", "chat", "email", "notify"],
  file: ["file", "read", "write", "filesystem", "fs"],
  code: ["code", "edit", "modify", "commit", "git"],
};

const ACTION_PATTERNS: Record<string, string[]> = {
  read: ["read", "view", "get", "fetch", "list", "search"],
  write: ["write", "create", "update", "modify", "edit", "set"],
  delete: ["delete", "remove", "destroy", "drop", "purge"],
  send: ["send", "post", "submit", "publish", "deliver"],
};

function extractToolConstraints(text: string): CompiledConstraint | null {
  const lower = text.toLowerCase();

  // Check for "only X" or "allow X" patterns (allowlist)
  const onlyMatch = lower.match(/\b(?:only|allow(?:ed)?|restrict(?:ed)?\s+to)\s+(.+?)(?:\.|$)/);
  if (onlyMatch) {
    const fragment = onlyMatch[1]!;
    const tools: string[] = [];
    for (const [tool, patterns] of Object.entries(TOOL_PATTERNS)) {
      if (patterns.some((p) => fragment.includes(p))) {
        tools.push(tool);
      }
    }
    if (tools.length > 0) {
      return { type: "tool_allowlist", tools };
    }
  }

  // Check for "no X" or "deny X" or "block X" patterns (denylist)
  const denyMatch = lower.match(/\b(?:no|deny|block|forbid|prevent|disallow)\s+(.+?)(?:\.|$)/);
  if (denyMatch) {
    const fragment = denyMatch[1]!;
    const tools: string[] = [];
    for (const [tool, patterns] of Object.entries(TOOL_PATTERNS)) {
      if (patterns.some((p) => fragment.includes(p))) {
        tools.push(tool);
      }
    }
    if (tools.length > 0) {
      return { type: "tool_denylist", tools };
    }
  }

  return null;
}

function extractActionConstraints(text: string): CompiledConstraint | null {
  const lower = text.toLowerCase();

  // "read only" / "read-only" / "readonly"
  if (/\bread[\s-]?only\b/.test(lower)) {
    return {
      type: "action_restriction",
      actions: ["read", "view", "get", "fetch", "list", "search"],
    };
  }

  // "no write" / "no delete" etc.
  const noActionMatch = lower.match(/\b(?:no|deny|block)\s+(write|delete|send|create|modify)\b/);
  if (noActionMatch) {
    const blockedAction = noActionMatch[1]!;
    const expanded = ACTION_PATTERNS[blockedAction] ?? [blockedAction];
    return { type: "action_restriction", actions: expanded };
  }

  return null;
}

function extractRateLimit(text: string): CompiledConstraint | null {
  const lower = text.toLowerCase();

  // "max N per minute" / "limit N/min"
  const perMinMatch = lower.match(
    /(?:max|limit|at most)\s+(\d+)\s*(?:per|\/)\s*(?:min(?:ute)?|m)\b/,
  );
  if (perMinMatch) {
    return { type: "rate_limit", maxPerMinute: parseInt(perMinMatch[1]!, 10) };
  }

  // "max N per hour" / "limit N/hr"
  const perHrMatch = lower.match(/(?:max|limit|at most)\s+(\d+)\s*(?:per|\/)\s*(?:hour|hr|h)\b/);
  if (perHrMatch) {
    return { type: "rate_limit", maxPerHour: parseInt(perHrMatch[1]!, 10) };
  }

  return null;
}

function extractTimeWindow(text: string): CompiledConstraint | null {
  const lower = text.toLowerCase();

  // "between HH and HH" / "from HH to HH"
  const timeMatch = lower.match(
    /(?:between|from)\s+(\d{1,2})\s*(?::00)?\s*(?:and|to|-)\s*(\d{1,2})\s*(?::00)?\s*(?:utc)?/,
  );
  if (timeMatch) {
    return {
      type: "time_window",
      allowedHoursUtc: {
        start: parseInt(timeMatch[1]!, 10),
        end: parseInt(timeMatch[2]!, 10),
      },
    };
  }

  // "business hours" → 9-17 UTC
  if (/\bbusiness\s+hours\b/.test(lower)) {
    return { type: "time_window", allowedHoursUtc: { start: 9, end: 17 } };
  }

  return null;
}

function extractPurpose(text: string): CompiledConstraint | null {
  const lower = text.toLowerCase();

  // "for X only" / "purpose: X"
  const purposeMatch = lower.match(/\b(?:for|purpose:?)\s+(.+?)(?:\s+only|\.|$)/);
  if (purposeMatch) {
    const purpose = purposeMatch[1]!.trim();
    if (purpose.length > 0 && purpose.length < 100) {
      return { type: "purpose_restriction", purposes: [purpose] };
    }
  }

  return null;
}

/**
 * Compile a rule's text into structured constraints.
 */
export function compileRule(text: string): CompiledConstraint[] {
  const constraints: CompiledConstraint[] = [];

  const toolConstraint = extractToolConstraints(text);
  if (toolConstraint) {
    constraints.push(toolConstraint);
  }

  const actionConstraint = extractActionConstraints(text);
  if (actionConstraint) {
    constraints.push(actionConstraint);
  }

  const rateLimit = extractRateLimit(text);
  if (rateLimit) {
    constraints.push(rateLimit);
  }

  const timeWindow = extractTimeWindow(text);
  if (timeWindow) {
    constraints.push(timeWindow);
  }

  const purpose = extractPurpose(text);
  if (purpose) {
    constraints.push(purpose);
  }

  return constraints;
}

// ---------------------------------------------------------------------------
// Constraint evaluation
// ---------------------------------------------------------------------------

function evaluateConstraint(
  constraint: CompiledConstraint,
  ctx: PolicyCheckContext,
): { allowed: boolean; reason?: string } {
  switch (constraint.type) {
    case "tool_allowlist": {
      if (!ctx.toolName) {
        return { allowed: true };
      }
      const allowed = constraint.tools?.includes(ctx.toolName) ?? true;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: `tool "${ctx.toolName}" not in allowlist` };
    }

    case "tool_denylist": {
      if (!ctx.toolName) {
        return { allowed: true };
      }
      const denied = constraint.tools?.includes(ctx.toolName) ?? false;
      return denied
        ? { allowed: false, reason: `tool "${ctx.toolName}" is denied` }
        : { allowed: true };
    }

    case "action_restriction": {
      if (!ctx.action) {
        return { allowed: true };
      }
      const actionAllowed = constraint.actions?.includes(ctx.action) ?? true;
      return actionAllowed
        ? { allowed: true }
        : { allowed: false, reason: `action "${ctx.action}" is restricted` };
    }

    case "rate_limit":
      // Rate limiting requires usage history; evaluated at service level
      return { allowed: true };

    case "time_window": {
      if (!constraint.allowedHoursUtc) {
        return { allowed: true };
      }
      const now = ctx.timestampMs ? new Date(ctx.timestampMs) : new Date();
      const hour = now.getUTCHours();
      const { start, end } = constraint.allowedHoursUtc;
      const inWindow = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
      return inWindow
        ? { allowed: true }
        : { allowed: false, reason: `outside allowed hours (${start}-${end} UTC)` };
    }

    case "purpose_restriction":
      // Purpose restrictions are advisory; not enforceable at runtime
      return { allowed: true };
  }
}

/**
 * Evaluate all rules for a credential against a checkout context.
 */
export function evaluateRules(rules: PermissionRule[], ctx: PolicyCheckContext): PolicyEvalResult {
  const matchedRules: string[] = [];
  let blocked = false;
  let blockReason: string | undefined;

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    for (const constraint of rule.compiledConstraints) {
      const result = evaluateConstraint(constraint, ctx);
      if (!result.allowed) {
        blocked = true;
        blockReason = result.reason;
        matchedRules.push(rule.id);
        break;
      }
    }

    if (blocked) {
      break;
    }
  }

  return {
    allowed: !blocked,
    reason: blockReason,
    matchedRules,
  };
}
