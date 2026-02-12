// ---------------------------------------------------------------------------
// TaskPolicy – Per-task restriction policy types
// ---------------------------------------------------------------------------
// A TaskPolicy composes with (and can only further restrict) the agent-level
// tool policy. When a task is active, the enforcer intersects these rules
// with the agent baseline to determine what the agent can do.
// ---------------------------------------------------------------------------

export type DomainCategory = "financial" | "social" | "email" | "shopping" | "admin";

export type ApprovalTrigger =
  | "financial_navigation"
  | "email_send"
  | "message_send"
  | "file_delete"
  | "dangerous_command"
  | "form_submission"
  | "purchase_flow";

export type TaskPolicyPreset = "research" | "coding" | "messaging" | "full" | "readonly" | "custom";

export interface TaskPolicyTools {
  /** Shorthand profile preset. */
  profile?: TaskPolicyPreset;
  /** Intersected with agent allow (can only restrict). */
  allow?: string[];
  /** Unioned with agent deny (adds restrictions). */
  deny?: string[];
}

export interface TaskPolicyBrowser {
  enabled?: boolean;
  urlAllowlist?: string[];
  urlBlocklist?: string[];
  blockedCategories?: DomainCategory[];
  /** Snapshot/screenshot only, no act/navigate/type. */
  readOnly?: boolean;
  blockFormSubmissions?: boolean;
  blockJsEval?: boolean;
  maxPages?: number;
  isolateSession?: boolean;
}

export interface TaskPolicyExec {
  security?: "deny" | "allowlist";
  allowCommands?: string[];
  denyCommands?: string[];
  blockDestructive?: boolean;
}

export interface TaskPolicyMessaging {
  enabled?: boolean;
  requireApproval?: boolean;
  allowRecipients?: string[];
  denyRecipients?: string[];
}

export interface TaskPolicyFilesystem {
  mode?: "none" | "read-only" | "read-write";
  allowPaths?: string[];
  denyPaths?: string[];
  blockDelete?: boolean;
}

export interface TaskPolicyBudgets {
  maxTokens?: number;
  maxCostUsd?: number;
  maxDurationSec?: number;
  maxToolCalls?: number;
  maxBrowserPages?: number;
  maxApiCalls?: number;
}

export interface TaskPolicyApproval {
  requireApprovalFor?: ApprovalTrigger[];
  timeoutSec?: number;
  timeoutAction?: "deny" | "skip" | "escalate";
  batchApproval?: boolean;
  /** How long to remember an approval decision (seconds). */
  approvalMemorySec?: number;
}

export interface TaskPolicy {
  preset?: TaskPolicyPreset;
  tools?: TaskPolicyTools;
  browser?: TaskPolicyBrowser;
  exec?: TaskPolicyExec;
  messaging?: TaskPolicyMessaging;
  filesystem?: TaskPolicyFilesystem;
  budgets?: TaskPolicyBudgets;
  approval?: TaskPolicyApproval;
}

// ---------------------------------------------------------------------------
// Policy presets
// ---------------------------------------------------------------------------

export const TASK_POLICY_PRESETS: Record<TaskPolicyPreset, TaskPolicy> = {
  research: {
    preset: "research",
    tools: {
      allow: ["group:web", "group:memory", "browser"],
      deny: ["group:fs", "group:runtime"],
    },
    browser: { readOnly: true, blockedCategories: ["financial", "shopping"] },
    exec: { security: "deny" },
    filesystem: { mode: "none" },
    messaging: { enabled: false },
  },
  coding: {
    preset: "coding",
    tools: { profile: "coding" },
    browser: { blockedCategories: ["financial"] },
    messaging: { enabled: false },
  },
  messaging: {
    preset: "messaging",
    tools: { profile: "messaging" },
    browser: { enabled: false },
    exec: { security: "deny" },
    filesystem: { mode: "none" },
  },
  readonly: {
    preset: "readonly",
    tools: { allow: ["group:web", "group:memory", "group:sessions"] },
    browser: { readOnly: true },
    exec: { security: "deny" },
    filesystem: { mode: "read-only" },
    messaging: { enabled: false },
  },
  full: {
    preset: "full",
    // No restrictions beyond global sensitivity rules
  },
  custom: {
    preset: "custom",
  },
};

// ---------------------------------------------------------------------------
// Resolve a task policy from raw config
// ---------------------------------------------------------------------------

export function resolveTaskPolicy(raw: Record<string, unknown> | undefined): TaskPolicy {
  if (!raw) {
    return {};
  }

  // If a preset name is provided, start from that preset
  const presetName = raw.preset as TaskPolicyPreset | undefined;
  const base = presetName ? { ...TASK_POLICY_PRESETS[presetName] } : {};

  // Override with any explicitly provided sections
  return {
    ...base,
    ...(raw as TaskPolicy),
  };
}
