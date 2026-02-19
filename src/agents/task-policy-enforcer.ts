// ---------------------------------------------------------------------------
// TaskPolicyEnforcer – Enforces per-task policies on tool invocations
// ---------------------------------------------------------------------------
// Hooks into the tool-call pipeline. For each tool invocation during a task:
//   1. Check tool allow/deny (intersection with agent policy)
//   2. Check browser URL restrictions (allowlist/blocklist/categories)
//   3. Check exec command restrictions
//   4. Check filesystem path restrictions
//   5. Check messaging restrictions
//   6. Evaluate sensitivity rules
//   7. Check budget limits
//   8. If approval needed: pause task, emit approval_required, wait
// ---------------------------------------------------------------------------

import type { TaskPolicy } from "./task-policy.js";
import { classifyDomain, isDomainBlocked } from "./domain-categories.js";
import {
  BUILT_IN_RULES,
  evaluateAllRules,
  type RuleMatchContext,
  type SensitivityRule,
} from "./sensitivity-rules.js";
import { resolveTaskPolicy } from "./task-policy.js";
import { expandToolGroups } from "./tool-policy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnforceResult = {
  allowed: boolean;
  reason?: string;
  action: "allow" | "block" | "require_approval";
  triggeredRules: string[];
  budgetExceeded?: string;
};

export type BudgetState = {
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
  toolCalls: number;
  browserPages: number;
  apiCalls: number;
};

export type EnforceContext = {
  toolName: string;
  params: Record<string, unknown>;
  url?: string;
  command?: string;
  browserAction?: string;
  filePath?: string;
  recipient?: string;
  credentialId?: string;
  credentialCategory?: string;
};

type SessionEntry = {
  policy: TaskPolicy;
  budget: BudgetState;
  startedAtMs: number;
  approvalCache: Map<string, { expiresAtMs: number }>;
};

// ---------------------------------------------------------------------------
// Enforcer
// ---------------------------------------------------------------------------

export class TaskPolicyEnforcer {
  private sessions = new Map<string, SessionEntry>();
  private customRules: SensitivityRule[] = [];

  /**
   * Attach a policy to a task session.
   */
  attach(sessionKey: string, rawPolicy: Record<string, unknown> | undefined): void {
    const policy = resolveTaskPolicy(rawPolicy);
    this.sessions.set(sessionKey, {
      policy,
      budget: {
        tokensUsed: 0,
        costUsd: 0,
        durationMs: 0,
        toolCalls: 0,
        browserPages: 0,
        apiCalls: 0,
      },
      startedAtMs: Date.now(),
      approvalCache: new Map(),
    });
  }

  /**
   * Detach a policy from a session (task completed/cancelled).
   */
  detach(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  /**
   * Check if a session has a policy attached.
   */
  hasPolicy(sessionKey: string): boolean {
    return this.sessions.has(sessionKey);
  }

  /**
   * Get the current budget state for a session.
   */
  getBudget(sessionKey: string): BudgetState | undefined {
    return this.sessions.get(sessionKey)?.budget;
  }

  /**
   * Record budget consumption for a tool call.
   */
  recordUsage(sessionKey: string, usage: Partial<BudgetState>): void {
    const entry = this.sessions.get(sessionKey);
    if (!entry) {
      return;
    }

    if (usage.tokensUsed) {
      entry.budget.tokensUsed += usage.tokensUsed;
    }
    if (usage.costUsd) {
      entry.budget.costUsd += usage.costUsd;
    }
    if (usage.durationMs) {
      entry.budget.durationMs += usage.durationMs;
    }
    if (usage.toolCalls) {
      entry.budget.toolCalls += usage.toolCalls;
    }
    if (usage.browserPages) {
      entry.budget.browserPages += usage.browserPages;
    }
    if (usage.apiCalls) {
      entry.budget.apiCalls += usage.apiCalls;
    }
  }

  /**
   * Cache an approval decision so similar actions auto-approve.
   */
  cacheApproval(sessionKey: string, ruleId: string, ttlMs: number): void {
    const entry = this.sessions.get(sessionKey);
    if (!entry) {
      return;
    }
    entry.approvalCache.set(ruleId, { expiresAtMs: Date.now() + ttlMs });
  }

  /**
   * Add custom sensitivity rules (from user config).
   */
  addCustomRules(rules: SensitivityRule[]): void {
    this.customRules.push(...rules);
  }

  /**
   * Enforce the policy for a tool invocation.
   */
  enforce(sessionKey: string, ctx: EnforceContext): EnforceResult {
    const entry = this.sessions.get(sessionKey);
    if (!entry) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    const { policy } = entry;

    // 1. Check tool allow/deny
    const toolResult = this.checkToolAccess(policy, ctx.toolName);
    if (!toolResult.allowed) {
      return toolResult;
    }

    // 2. Check browser restrictions
    if (ctx.url) {
      const browserResult = this.checkBrowserRestrictions(policy, ctx);
      if (!browserResult.allowed) {
        return browserResult;
      }
    }

    // 3. Check exec restrictions
    if (ctx.command) {
      const execResult = this.checkExecRestrictions(policy, ctx.command);
      if (!execResult.allowed) {
        return execResult;
      }
    }

    // 4. Check filesystem restrictions
    if (ctx.filePath) {
      const fsResult = this.checkFilesystemRestrictions(policy, ctx.filePath, ctx.toolName);
      if (!fsResult.allowed) {
        return fsResult;
      }
    }

    // 5. Check messaging restrictions
    if (ctx.toolName === "message" || ctx.recipient) {
      const msgResult = this.checkMessagingRestrictions(policy, ctx.recipient);
      if (!msgResult.allowed) {
        return msgResult;
      }
    }

    // 6. Evaluate sensitivity rules
    const ruleCtx: RuleMatchContext = {
      toolName: ctx.toolName,
      params: ctx.params,
      url: ctx.url,
      command: ctx.command,
      browserAction: ctx.browserAction,
      domainCategories: ctx.url ? classifyDomain(ctx.url) : undefined,
    };
    const allRules = [...BUILT_IN_RULES, ...this.customRules];
    const ruleResult = evaluateAllRules(allRules, ruleCtx);

    if (ruleResult.action === "block") {
      return {
        allowed: false,
        action: "block",
        reason: `Blocked by sensitivity rule(s): ${ruleResult.triggeredRules.join(", ")}`,
        triggeredRules: ruleResult.triggeredRules,
      };
    }

    if (ruleResult.action === "require_approval") {
      // Check approval cache
      const cached = this.checkApprovalCache(entry, ruleResult.triggeredRules);
      if (!cached) {
        return {
          allowed: false,
          action: "require_approval",
          reason: `Approval required by rule(s): ${ruleResult.triggeredRules.join(", ")}`,
          triggeredRules: ruleResult.triggeredRules,
        };
      }
    }

    // 7. Check budget limits
    const budgetResult = this.checkBudgetLimits(policy, entry.budget, entry.startedAtMs);
    if (!budgetResult.allowed) {
      return budgetResult;
    }

    // 8. Check credential restrictions
    if (ctx.credentialId || ctx.credentialCategory) {
      const credResult = this.checkCredentialRestrictions(
        policy,
        ctx.credentialId,
        ctx.credentialCategory,
      );
      if (!credResult.allowed) {
        return credResult;
      }
    }

    // Record this tool call
    entry.budget.toolCalls += 1;

    return {
      allowed: true,
      action: "allow",
      triggeredRules: ruleResult.triggeredRules,
    };
  }

  // -------------------------------------------------------------------------
  // Private checks
  // -------------------------------------------------------------------------

  private checkToolAccess(policy: TaskPolicy, toolName: string): EnforceResult {
    if (!policy.tools) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    const { allow, deny } = policy.tools;

    if (deny) {
      const expanded = expandToolGroups(deny);
      if (expanded.includes(toolName)) {
        return {
          allowed: false,
          action: "block",
          reason: `Tool "${toolName}" is denied by task policy`,
          triggeredRules: [],
        };
      }
    }

    if (allow) {
      const expanded = expandToolGroups(allow);
      if (!expanded.includes(toolName)) {
        return {
          allowed: false,
          action: "block",
          reason: `Tool "${toolName}" is not in task allow list`,
          triggeredRules: [],
        };
      }
    }

    return { allowed: true, action: "allow", triggeredRules: [] };
  }

  private checkBrowserRestrictions(policy: TaskPolicy, ctx: EnforceContext): EnforceResult {
    const browser = policy.browser;
    if (!browser) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    if (browser.enabled === false) {
      return {
        allowed: false,
        action: "block",
        reason: "Browser access disabled by task policy",
        triggeredRules: [],
      };
    }

    if (browser.readOnly && ctx.browserAction && ctx.browserAction !== "snapshot") {
      const writingActions = ["type", "click", "navigate", "fill"];
      if (writingActions.includes(ctx.browserAction)) {
        return {
          allowed: false,
          action: "block",
          reason: "Browser is read-only for this task",
          triggeredRules: [],
        };
      }
    }

    if (browser.blockFormSubmissions && ctx.browserAction === "type") {
      return {
        allowed: false,
        action: "block",
        reason: "Form submissions blocked by task policy",
        triggeredRules: [],
      };
    }

    if (ctx.url) {
      if (browser.urlBlocklist?.length) {
        const blocked = browser.urlBlocklist.some((pattern) => ctx.url!.includes(pattern));
        if (blocked) {
          return {
            allowed: false,
            action: "block",
            reason: `URL blocked by task policy blocklist`,
            triggeredRules: [],
          };
        }
      }

      if (browser.urlAllowlist?.length) {
        const allowed = browser.urlAllowlist.some((pattern) => ctx.url!.includes(pattern));
        if (!allowed) {
          return {
            allowed: false,
            action: "block",
            reason: `URL not in task policy allowlist`,
            triggeredRules: [],
          };
        }
      }

      if (browser.blockedCategories?.length) {
        if (isDomainBlocked(ctx.url, browser.blockedCategories)) {
          return {
            allowed: false,
            action: "block",
            reason: `URL belongs to a blocked domain category`,
            triggeredRules: [],
          };
        }
      }
    }

    return { allowed: true, action: "allow", triggeredRules: [] };
  }

  private checkExecRestrictions(policy: TaskPolicy, command: string): EnforceResult {
    const exec = policy.exec;
    if (!exec) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    if (exec.security === "deny") {
      return {
        allowed: false,
        action: "block",
        reason: "Command execution denied by task policy",
        triggeredRules: [],
      };
    }

    if (exec.blockDestructive) {
      const destructive = /\brm\s|\brmdir\s|\bdel\s|\bshred\s|\bRemove-Item\b/i;
      if (destructive.test(command)) {
        return {
          allowed: false,
          action: "block",
          reason: "Destructive command blocked by task policy",
          triggeredRules: [],
        };
      }
    }

    if (exec.denyCommands?.length) {
      for (const pattern of exec.denyCommands) {
        if (command.includes(pattern)) {
          return {
            allowed: false,
            action: "block",
            reason: `Command matches deny pattern: ${pattern}`,
            triggeredRules: [],
          };
        }
      }
    }

    if (exec.security === "allowlist" && exec.allowCommands?.length) {
      const allowed = exec.allowCommands.some((pattern) => command.startsWith(pattern));
      if (!allowed) {
        return {
          allowed: false,
          action: "block",
          reason: "Command not in task policy allowlist",
          triggeredRules: [],
        };
      }
    }

    return { allowed: true, action: "allow", triggeredRules: [] };
  }

  private checkFilesystemRestrictions(
    policy: TaskPolicy,
    filePath: string,
    toolName: string,
  ): EnforceResult {
    const fs = policy.filesystem;
    if (!fs) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    if (fs.mode === "none") {
      return {
        allowed: false,
        action: "block",
        reason: "Filesystem access denied by task policy",
        triggeredRules: [],
      };
    }

    const isWriteOp = toolName === "write" || toolName === "edit" || toolName === "apply_patch";
    if (fs.mode === "read-only" && isWriteOp) {
      return {
        allowed: false,
        action: "block",
        reason: "Filesystem is read-only for this task",
        triggeredRules: [],
      };
    }

    if (fs.blockDelete && /\bdelete\b|\bremove\b|\bunlink\b/i.test(toolName)) {
      return {
        allowed: false,
        action: "block",
        reason: "File deletion blocked by task policy",
        triggeredRules: [],
      };
    }

    if (fs.denyPaths?.length) {
      for (const pattern of fs.denyPaths) {
        if (filePath.startsWith(pattern)) {
          return {
            allowed: false,
            action: "block",
            reason: `Path "${filePath}" is denied by task policy`,
            triggeredRules: [],
          };
        }
      }
    }

    if (fs.allowPaths?.length) {
      const allowed = fs.allowPaths.some((p) => filePath.startsWith(p));
      if (!allowed) {
        return {
          allowed: false,
          action: "block",
          reason: `Path "${filePath}" is not in task policy allow list`,
          triggeredRules: [],
        };
      }
    }

    return { allowed: true, action: "allow", triggeredRules: [] };
  }

  private checkMessagingRestrictions(policy: TaskPolicy, recipient?: string): EnforceResult {
    const msg = policy.messaging;
    if (!msg) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    if (msg.enabled === false) {
      return {
        allowed: false,
        action: "block",
        reason: "Messaging disabled by task policy",
        triggeredRules: [],
      };
    }

    if (msg.requireApproval) {
      return {
        allowed: false,
        action: "require_approval",
        reason: "Messaging requires approval for this task",
        triggeredRules: [],
      };
    }

    if (recipient) {
      if (msg.denyRecipients?.includes(recipient)) {
        return {
          allowed: false,
          action: "block",
          reason: `Recipient "${recipient}" is denied by task policy`,
          triggeredRules: [],
        };
      }

      if (msg.allowRecipients?.length) {
        if (!msg.allowRecipients.includes(recipient)) {
          return {
            allowed: false,
            action: "block",
            reason: `Recipient "${recipient}" is not in task policy allow list`,
            triggeredRules: [],
          };
        }
      }
    }

    return { allowed: true, action: "allow", triggeredRules: [] };
  }

  private checkBudgetLimits(
    policy: TaskPolicy,
    budget: BudgetState,
    startedAtMs: number,
  ): EnforceResult {
    const limits = policy.budgets;
    if (!limits) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    if (limits.maxTokens && budget.tokensUsed >= limits.maxTokens) {
      return {
        allowed: false,
        action: "block",
        reason: `Token budget exceeded (${budget.tokensUsed}/${limits.maxTokens})`,
        triggeredRules: [],
        budgetExceeded: "tokens",
      };
    }

    if (limits.maxCostUsd && budget.costUsd >= limits.maxCostUsd) {
      return {
        allowed: false,
        action: "block",
        reason: `Cost budget exceeded ($${budget.costUsd.toFixed(4)}/$${limits.maxCostUsd})`,
        triggeredRules: [],
        budgetExceeded: "cost",
      };
    }

    if (limits.maxDurationSec) {
      const elapsed = (Date.now() - startedAtMs) / 1000;
      if (elapsed >= limits.maxDurationSec) {
        return {
          allowed: false,
          action: "block",
          reason: `Duration budget exceeded (${Math.round(elapsed)}s/${limits.maxDurationSec}s)`,
          triggeredRules: [],
          budgetExceeded: "duration",
        };
      }
    }

    if (limits.maxToolCalls && budget.toolCalls >= limits.maxToolCalls) {
      return {
        allowed: false,
        action: "block",
        reason: `Tool call budget exceeded (${budget.toolCalls}/${limits.maxToolCalls})`,
        triggeredRules: [],
        budgetExceeded: "toolCalls",
      };
    }

    if (limits.maxBrowserPages && budget.browserPages >= limits.maxBrowserPages) {
      return {
        allowed: false,
        action: "block",
        reason: `Browser page budget exceeded (${budget.browserPages}/${limits.maxBrowserPages})`,
        triggeredRules: [],
        budgetExceeded: "browserPages",
      };
    }

    if (limits.maxApiCalls && budget.apiCalls >= limits.maxApiCalls) {
      return {
        allowed: false,
        action: "block",
        reason: `API call budget exceeded (${budget.apiCalls}/${limits.maxApiCalls})`,
        triggeredRules: [],
        budgetExceeded: "apiCalls",
      };
    }

    return { allowed: true, action: "allow", triggeredRules: [] };
  }

  private checkApprovalCache(entry: SessionEntry, triggeredRuleIds: string[]): boolean {
    const now = Date.now();
    for (const ruleId of triggeredRuleIds) {
      const cached = entry.approvalCache.get(ruleId);
      if (!cached || cached.expiresAtMs < now) {
        return false;
      }
    }
    return triggeredRuleIds.length > 0;
  }

  private checkCredentialRestrictions(
    policy: TaskPolicy,
    credentialId?: string,
    credentialCategory?: string,
  ): EnforceResult {
    const credPolicy = policy.credentials;
    if (!credPolicy) {
      return { allowed: true, action: "allow", triggeredRules: [] };
    }

    // Check deny list
    if (credentialId && credPolicy.deny?.length) {
      if (credPolicy.deny.includes(credentialId)) {
        return {
          allowed: false,
          action: "block",
          reason: `Credential ${credentialId} is denied by task policy`,
          triggeredRules: ["credential:deny"],
        };
      }
    }

    // Check allow list (if set, credential must be in it)
    if (credentialId && credPolicy.allow?.length) {
      if (!credPolicy.allow.includes(credentialId)) {
        return {
          allowed: false,
          action: "block",
          reason: `Credential ${credentialId} is not in the allow list`,
          triggeredRules: ["credential:allow"],
        };
      }
    }

    // Check category restrictions
    if (credentialCategory && credPolicy.allowCategories?.length) {
      if (!credPolicy.allowCategories.includes(credentialCategory)) {
        return {
          allowed: false,
          action: "block",
          reason: `Credential category "${credentialCategory}" is not allowed`,
          triggeredRules: ["credential:category"],
        };
      }
    }

    return { allowed: true, action: "allow", triggeredRules: [] };
  }
}
