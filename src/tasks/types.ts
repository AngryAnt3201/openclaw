// ---------------------------------------------------------------------------
// Task System – Core Types
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "input_required"
  | "approval_required"
  | "review"
  | "paused"
  | "complete"
  | "failed"
  | "cancelled";

export type TaskSource = "user" | "heartbeat" | "cron" | "agent" | "api";

export type TaskType =
  | "instruction"
  | "app_launch"
  | "workflow"
  | "scheduled"
  | "monitoring"
  | "approval_gate";

export type TaskPriority = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Domain / Category classification (used by policy enforcer)
// ---------------------------------------------------------------------------

export type DomainCategory = "financial" | "social" | "email" | "shopping" | "admin";

// ---------------------------------------------------------------------------
// Approval types
// ---------------------------------------------------------------------------

export type ApprovalSeverity = "low" | "medium" | "high" | "critical";

export type ApprovalTrigger =
  | "browser_navigation"
  | "form_submission"
  | "exec_command"
  | "file_delete"
  | "message_send"
  | "financial_domain"
  | "admin_domain"
  | "budget_exceeded";

export type ApprovalRequest = {
  id: string;
  toolName: string;
  action: string;
  params?: Record<string, unknown>;
  severity: ApprovalSeverity;
  reason: string;
  createdAtMs: number;
  expiresAtMs?: number;
  triggeredRules?: string[];
};

// ---------------------------------------------------------------------------
// Budget tracking
// ---------------------------------------------------------------------------

export type BudgetUsage = {
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
  toolCalls: number;
  browserPages: number;
  apiCalls: number;
};

// ---------------------------------------------------------------------------
// Task Policy (per-task restriction set)
// ---------------------------------------------------------------------------

export type TaskPolicy = {
  preset?: string;
  tools?: {
    profile?: "minimal" | "coding" | "messaging" | "full" | "research" | "readonly";
    allow?: string[];
    deny?: string[];
  };
  browser?: {
    enabled?: boolean;
    urlAllowlist?: string[];
    urlBlocklist?: string[];
    blockedCategories?: DomainCategory[];
    readOnly?: boolean;
    blockFormSubmissions?: boolean;
    blockJsEval?: boolean;
    maxPages?: number;
    isolateSession?: boolean;
  };
  exec?: {
    security?: "deny" | "allowlist";
    allowCommands?: string[];
    denyCommands?: string[];
    blockDestructive?: boolean;
  };
  messaging?: {
    enabled?: boolean;
    requireApproval?: boolean;
    allowRecipients?: string[];
    denyRecipients?: string[];
  };
  filesystem?: {
    mode?: "none" | "read-only" | "read-write";
    allowPaths?: string[];
    denyPaths?: string[];
    blockDelete?: boolean;
  };
  budgets?: {
    maxTokens?: number;
    maxCostUsd?: number;
    maxDurationSec?: number;
    maxToolCalls?: number;
    maxBrowserPages?: number;
    maxApiCalls?: number;
  };
  approval?: {
    requireApprovalFor?: ApprovalTrigger[];
    timeoutSec?: number;
    timeoutAction?: "deny" | "skip" | "escalate";
    batchApproval?: boolean;
    approvalMemorySec?: number;
  };
};

// ---------------------------------------------------------------------------
// Sub-task (for workflow task hierarchy)
// ---------------------------------------------------------------------------

export type SubTask = {
  id: string;
  title: string;
  status: TaskStatus;
  progress?: number;
};

// ---------------------------------------------------------------------------
// Task result
// ---------------------------------------------------------------------------

export type TaskResult = {
  success: boolean;
  summary?: string;
  artifacts?: string[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Live stream data
// ---------------------------------------------------------------------------

export type TaskLiveStream = {
  screenshotUrls: string[];
  latestScreenshot?: string;
};

// ---------------------------------------------------------------------------
// Cron binding (for scheduled tasks)
// ---------------------------------------------------------------------------

export type CronBinding = {
  cronJobId: string;
  schedule: string;
  lastRunAt?: number;
  nextRunAt?: number;
};

// ---------------------------------------------------------------------------
// Inline app reference (for embedding clickable app chips in text)
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: "open_url"; url: string }
  | { type: "deep_link"; uri: string }
  | { type: "launch_native"; appPath: string }
  | { type: "open_task"; taskId: string }
  | { type: "noop" };

export type AppRefStyle = "chip" | "obsidian-link";

export type AppReference = {
  appSlug: string;
  label: string;
  action: AppAction;
  style?: AppRefStyle;
  subtitle?: string;
};

// ---------------------------------------------------------------------------
// Task app reference
// ---------------------------------------------------------------------------

export type TaskApp = {
  name: string;
  icon: string;
};

// ---------------------------------------------------------------------------
// Core Task interface
// ---------------------------------------------------------------------------

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  source: TaskSource;
  agentId: string;
  sessionKey?: string;
  app?: TaskApp;

  // Hierarchy
  parentTaskId?: string;
  subTasks?: SubTask[];

  // Scheduling
  cronBinding?: CronBinding;

  // Permissions
  permissions?: TaskPolicy;

  // Approval
  approvalRequest?: ApprovalRequest;

  // Result
  result?: TaskResult;

  // Live monitoring
  liveStream?: TaskLiveStream;

  // Budget
  budgetUsage?: BudgetUsage;

  // Progress
  progress?: number;
  progressMessage?: string;

  // Input prompt (for input_required status)
  inputPrompt?: string;

  // Review summary (for review status)
  reviewSummary?: string;

  // Inline app references
  refs?: AppReference[];

  // Timestamps
  createdAtMs: number;
  updatedAtMs: number;
};

// ---------------------------------------------------------------------------
// Task creation input (user-facing)
// ---------------------------------------------------------------------------

export type TaskCreateInput = {
  title: string;
  description?: string;
  type?: TaskType;
  source?: TaskSource;
  priority?: TaskPriority;
  agentId?: string;
  parentTaskId?: string;
  permissions?: TaskPolicy;
  app?: TaskApp;
  cronBinding?: CronBinding;
  refs?: AppReference[];
};

// ---------------------------------------------------------------------------
// Task patch (partial update)
// ---------------------------------------------------------------------------

export type TaskPatch = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  progress?: number;
  progressMessage?: string;
  inputPrompt?: string;
  reviewSummary?: string;
  sessionKey?: string;
  approvalRequest?: ApprovalRequest;
  result?: TaskResult;
  liveStream?: TaskLiveStream;
  budgetUsage?: BudgetUsage;
  permissions?: TaskPolicy;
  subTasks?: SubTask[];
  refs?: AppReference[];
};

// ---------------------------------------------------------------------------
// Task event log entries
// ---------------------------------------------------------------------------

export type TaskEventType =
  | "tool_use"
  | "progress"
  | "screenshot"
  | "navigation"
  | "output"
  | "approval_request"
  | "approval_resolved"
  | "error"
  | "status_change"
  | "input_provided"
  | "policy_check"
  | "budget_check"
  | "audit";

export type TaskEvent = {
  id: string;
  taskId: string;
  type: TaskEventType;
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Status updates (timeline cards)
// ---------------------------------------------------------------------------

export type StatusUpdateType =
  | "milestone" // Major accomplishment
  | "progress" // Incremental progress
  | "screenshot" // Visual capture
  | "error" // Error encountered
  | "complete"; // Final summary

export type StatusUpdateAttachment =
  | { kind: "screenshot"; path: string; url?: string; caption?: string }
  | { kind: "url"; url: string; title?: string }
  | { kind: "file_change"; path: string; action: "created" | "modified" | "deleted" }
  | { kind: "code_snippet"; language?: string; code: string; filename?: string }
  | { kind: "ref"; appSlug: string; label: string; action?: AppAction };

export type StatusUpdate = {
  id: string;
  taskId: string;
  type: StatusUpdateType;
  title: string;
  body: string; // Markdown
  attachments: StatusUpdateAttachment[];
  progress?: number; // 0-100 snapshot
  timestamp: number;
  source: "agent" | "auto";
};

export type StatusUpdateCreateInput = {
  taskId: string;
  type?: StatusUpdateType;
  title: string;
  body?: string;
  attachments?: StatusUpdateAttachment[];
  progress?: number;
  source?: "agent" | "auto";
};

// ---------------------------------------------------------------------------
// Task store file shape (persisted to disk)
// ---------------------------------------------------------------------------

export type TaskStoreFile = {
  version: 1;
  tasks: Task[];
};

// ---------------------------------------------------------------------------
// Task filter (for list queries)
// ---------------------------------------------------------------------------

export type TaskFilter = {
  status?: TaskStatus | TaskStatus[];
  source?: TaskSource;
  type?: TaskType;
  agentId?: string;
  parentTaskId?: string;
  limit?: number;
};
