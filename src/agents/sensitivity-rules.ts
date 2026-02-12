// ---------------------------------------------------------------------------
// Sensitivity Rules – Declarative rule database for tool-call evaluation
// ---------------------------------------------------------------------------
// Each rule is evaluated at every tool invocation during a task. When a rule
// matches, it returns an action: "block", "require_approval", or "allow".
// ---------------------------------------------------------------------------

import type { DomainCategory } from "./task-policy.js";

export type RuleAction = "block" | "require_approval" | "allow";

export type SensitivityRule = {
  id: string;
  name: string;
  description: string;
  category: string;
  action: RuleAction;
  /** Tool names this rule applies to (undefined = all tools). */
  toolNames?: string[];
  /** URL patterns to match for browser tools. */
  urlPatterns?: RegExp[];
  /** Domain categories to match. */
  domainCategories?: DomainCategory[];
  /** Command patterns to match for exec tools. */
  commandPatterns?: RegExp[];
  /** Browser actions to match (e.g. "navigate", "type", "click"). */
  browserActions?: string[];
  /** Custom match function for complex rules. */
  match?: (ctx: RuleMatchContext) => boolean;
};

export type RuleMatchContext = {
  toolName: string;
  params: Record<string, unknown>;
  url?: string;
  command?: string;
  browserAction?: string;
  domainCategories?: DomainCategory[];
};

export type RuleEvalResult = {
  matched: boolean;
  rule: SensitivityRule;
  action: RuleAction;
};

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

export const BUILT_IN_RULES: SensitivityRule[] = [
  {
    id: "financial.bank_site",
    name: "Financial Site Navigation",
    description: "Navigating to banking or financial services sites",
    category: "financial",
    action: "require_approval",
    toolNames: ["browser"],
    domainCategories: ["financial"],
  },
  {
    id: "financial.purchase_flow",
    name: "Purchase Flow Detection",
    description: "Detected form submission on a shopping/checkout page",
    category: "financial",
    action: "block",
    toolNames: ["browser"],
    domainCategories: ["shopping"],
    browserActions: ["type", "click"],
    match: (ctx) => {
      const url = ctx.url ?? "";
      return /checkout|payment|cart|order/i.test(url);
    },
  },
  {
    id: "messaging.email_send",
    name: "Email Send Detection",
    description: "Sending actions on email provider pages",
    category: "messaging",
    action: "require_approval",
    toolNames: ["browser"],
    domainCategories: ["email"],
    browserActions: ["click", "type"],
    match: (ctx) => {
      const url = ctx.url ?? "";
      return /compose|send|reply|forward/i.test(url);
    },
  },
  {
    id: "messaging.send_tool",
    name: "Message Tool Send",
    description: "Agent using the message send tool",
    category: "messaging",
    action: "require_approval",
    toolNames: ["message"],
  },
  {
    id: "destructive.file_delete",
    name: "Destructive File Operations",
    description: "Commands that delete files or directories",
    category: "destructive",
    action: "require_approval",
    toolNames: ["exec"],
    commandPatterns: [/\brm\s/, /\brmdir\s/, /\bshred\s/, /\bdel\s/, /\bRemove-Item\b/i],
  },
  {
    id: "system.dangerous_commands",
    name: "Dangerous System Commands",
    description: "Potentially destructive system-level commands",
    category: "system",
    action: "block",
    toolNames: ["exec"],
    commandPatterns: [
      /\bsudo\s/,
      /\bcurl\s.*\|\s*(?:ba)?sh\b/,
      /\bdd\s+if=/,
      /\bshutdown\b/,
      /\breboot\b/,
      /\bmkfs\b/,
      /\bformat\s/i,
      /\bnewfs\b/,
    ],
  },
  {
    id: "admin.cloud_console",
    name: "Cloud Admin Console Access",
    description: "Navigating to cloud infrastructure admin panels",
    category: "admin",
    action: "require_approval",
    toolNames: ["browser"],
    domainCategories: ["admin"],
  },
];

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

function matchesToolName(rule: SensitivityRule, toolName: string): boolean {
  if (!rule.toolNames || rule.toolNames.length === 0) {
    return true;
  }
  return rule.toolNames.includes(toolName);
}

function matchesDomainCategories(
  rule: SensitivityRule,
  categories: DomainCategory[] | undefined,
): boolean {
  if (!rule.domainCategories || rule.domainCategories.length === 0) {
    return true;
  }
  if (!categories || categories.length === 0) {
    return false;
  }
  const ruleSet = new Set(rule.domainCategories);
  return categories.some((c) => ruleSet.has(c));
}

function matchesBrowserAction(rule: SensitivityRule, action: string | undefined): boolean {
  if (!rule.browserActions || rule.browserActions.length === 0) {
    return true;
  }
  if (!action) {
    return false;
  }
  return rule.browserActions.includes(action);
}

function matchesCommandPattern(rule: SensitivityRule, command: string | undefined): boolean {
  if (!rule.commandPatterns || rule.commandPatterns.length === 0) {
    return true;
  }
  if (!command) {
    return false;
  }
  return rule.commandPatterns.some((p) => p.test(command));
}

function matchesUrlPattern(rule: SensitivityRule, url: string | undefined): boolean {
  if (!rule.urlPatterns || rule.urlPatterns.length === 0) {
    return true;
  }
  if (!url) {
    return false;
  }
  return rule.urlPatterns.some((p) => p.test(url));
}

/**
 * Evaluate a single rule against a match context.
 */
export function evaluateRule(rule: SensitivityRule, ctx: RuleMatchContext): RuleEvalResult {
  const matched =
    matchesToolName(rule, ctx.toolName) &&
    matchesDomainCategories(rule, ctx.domainCategories) &&
    matchesBrowserAction(rule, ctx.browserAction) &&
    matchesCommandPattern(rule, ctx.command) &&
    matchesUrlPattern(rule, ctx.url) &&
    (rule.match ? rule.match(ctx) : true);

  return { matched, rule, action: rule.action };
}

/**
 * Evaluate all rules against a context and return the most restrictive action.
 * Priority: block > require_approval > allow
 */
export function evaluateAllRules(
  rules: SensitivityRule[],
  ctx: RuleMatchContext,
): { action: RuleAction; triggeredRules: string[] } {
  const triggered: string[] = [];
  let maxAction: RuleAction = "allow";

  for (const rule of rules) {
    const result = evaluateRule(rule, ctx);
    if (!result.matched) {
      continue;
    }

    triggered.push(rule.id);

    if (result.action === "block") {
      maxAction = "block";
    } else if (result.action === "require_approval" && maxAction !== "block") {
      maxAction = "require_approval";
    }
  }

  return { action: maxAction, triggeredRules: triggered };
}
