// ---------------------------------------------------------------------------
// Workflow Engine – Core Types
// ---------------------------------------------------------------------------
// Mirrors frontend types from src/types/workflow.ts plus server-side types
// for the engine, store persistence, and event logging.
// ---------------------------------------------------------------------------

// ============================================================
// WORKFLOW — The high-level orchestration unit
// ============================================================

export type WorkflowStatus =
  | "planning"
  | "running"
  | "paused"
  | "reviewing"
  | "pr_open"
  | "merged"
  | "failed"
  | "cancelled";

export type WorkflowTrigger = "task" | "manual" | "issue" | "schedule" | "webhook";

export interface RepoContext {
  path: string;
  remote: string;
  remoteUrl: string;
  owner: string;
  name: string;
}

export interface Workflow {
  id: string;
  title: string;
  description: string;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;

  // Source references
  taskId?: string;
  issueNumber?: number;
  issueUrl?: string;

  // Git context
  repo: RepoContext;
  baseBranch: string;
  workBranch: string;

  // Session plan
  steps: WorkflowStep[];
  currentStepIndex: number;

  // PR
  pullRequest?: PRReference;

  // Review
  review?: CodeReview;

  // Timing
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;

  // Budget
  totalTokens: number;
  totalCost: number;
  totalToolCalls: number;
}

// ============================================================
// WORKFLOW STEPS — Individual session-backed units of work
// ============================================================

export type StepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  oldPath?: string;
}

export interface WorkflowStep {
  id: string;
  index: number;
  title: string;
  description: string;
  status: StepStatus;

  // Session binding
  sessionId?: number;
  sessionMode: "Claude" | "Gemini" | "Codex";

  // Dependencies
  dependsOn: string[];

  // Git
  commitsBefore: string[];
  commitsAfter: string[];
  filesChanged: FileChange[];

  // Results
  result?: string;
  error?: string;
  tokenUsage: number;
  toolCalls: number;

  // Credentials
  requiredCredentials?: Array<{
    credentialId: string;
    purpose: string;
    required: boolean;
  }>;

  // Timing
  startedAtMs?: number;
  completedAtMs?: number;
}

// ============================================================
// GIT / PR / ISSUE TYPES
// ============================================================

export interface PRCheck {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out";
  url?: string;
}

export interface PRReference {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed" | "merged" | "draft";
  headBranch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  filesChanged: number;
  checks: PRCheck[];
  reviewState?: "pending" | "approved" | "changes_requested";
  mergedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface GitHubIssue {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  milestone?: string;
  linkedPRs: number[];
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs?: number;
}

// ============================================================
// CODE REVIEW
// ============================================================

export type ReviewSeverity = "critical" | "warning" | "info";
export type ReviewCategory = "security" | "performance" | "correctness" | "style" | "complexity";

export interface ReviewIssue {
  severity: ReviewSeverity;
  file: string;
  line?: number;
  message: string;
  category: ReviewCategory;
}

export interface ReviewSuggestion {
  file: string;
  line: number;
  original: string;
  suggested: string;
  reason: string;
}

export interface CodeReview {
  status: "pending" | "in_progress" | "complete";
  summary: string;
  score: number;
  issues: ReviewIssue[];
  suggestions: ReviewSuggestion[];
  filesReviewed: string[];
  reviewedAtMs: number;
}

// ============================================================
// ORCHESTRATION INPUTS
// ============================================================

export interface WorkflowStepInput {
  title: string;
  description: string;
  dependsOn?: number[];
  sessionMode?: "Claude" | "Gemini" | "Codex";
}

export interface WorkflowCreateInput {
  title: string;
  description: string;
  trigger: WorkflowTrigger;
  taskId?: string;
  issueNumber?: number;
  repoPath: string;
  baseBranch?: string;
  branchName?: string;
  sessionMode?: "Claude" | "Gemini" | "Codex";
  steps?: WorkflowStepInput[];
  autoplan?: boolean;
  maxSessions?: number;
  maxTokenBudget?: number;
  autoCreatePR?: boolean;
  autoReview?: boolean;
  prTemplate?: string;
  branchPrefix?: string;
}

// ============================================================
// POLICIES
// ============================================================

export interface WorkflowPolicies {
  branchPrefixes: {
    feature: string;
    fix: string;
    chore: string;
    refactor: string;
  };
  pr: {
    requireReview: boolean;
    minReviewScore: number;
    requireTests: boolean;
    maxFilesChanged: number;
    labels: string[];
    assignees: string[];
    template?: string;
  };
  sessions: {
    maxConcurrent: number;
    maxTokensPerStep: number;
    maxTokensPerWorkflow: number;
    timeoutMs: number;
    allowedModes: ("Claude" | "Gemini" | "Codex")[];
  };
  commits: {
    conventionalCommits: boolean;
    signOff: boolean;
    maxMessageLength: number;
  };
  safety: {
    protectedBranches: string[];
    requireApprovalForForceOps: boolean;
    maxDeletionsPerPR: number;
  };
}

// ============================================================
// FILTERS
// ============================================================

export interface WorkflowFilter {
  status?: WorkflowStatus[];
  trigger?: WorkflowTrigger[];
  repo?: string;
  limit?: number;
}

export interface IssueFilter {
  state?: "open" | "closed";
  labels?: string[];
  repo?: string;
  limit?: number;
}

export interface PRFilter {
  state?: "open" | "closed" | "merged";
  labels?: string[];
  limit?: number;
}

// ============================================================
// CREATE / UPDATE INPUTS
// ============================================================

export interface IssueCreateInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number;
}

export interface IssueUpdateInput {
  owner: string;
  repo: string;
  number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  labels?: string[];
}

export interface PRCreateInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
  labels?: string[];
  assignees?: string[];
  linkedIssues?: number[];
}

export interface PRUpdateInput {
  owner: string;
  repo: string;
  number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  labels?: string[];
  draft?: boolean;
}

// ============================================================
// SERVER-SIDE TYPES
// ============================================================

/** Partial update to a workflow. */
export type WorkflowPatch = {
  title?: string;
  description?: string;
  status?: WorkflowStatus;
  currentStepIndex?: number;
  pullRequest?: PRReference;
  review?: CodeReview;
  startedAtMs?: number;
  completedAtMs?: number;
  totalTokens?: number;
  totalCost?: number;
  totalToolCalls?: number;
};

/** Partial update to a step. */
export type StepPatch = {
  status?: StepStatus;
  sessionId?: number;
  result?: string;
  error?: string;
  tokenUsage?: number;
  toolCalls?: number;
  commitsBefore?: string[];
  commitsAfter?: string[];
  filesChanged?: FileChange[];
  startedAtMs?: number;
  completedAtMs?: number;
};

// ============================================================
// EVENT LOG
// ============================================================

export type WorkflowEventType =
  | "status_change"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_skipped"
  | "session_spawned"
  | "session_completed"
  | "session_timeout"
  | "branch_created"
  | "branch_pushed"
  | "pr_created"
  | "pr_merged"
  | "review_started"
  | "review_completed"
  | "error"
  | "info";

export type WorkflowEvent = {
  id: string;
  workflowId: string;
  stepId?: string;
  type: WorkflowEventType;
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
};

// ============================================================
// STORE FILE
// ============================================================

export type WorkflowStoreFile = {
  version: 1;
  workflows: Workflow[];
};

// ============================================================
// STATE TRANSITIONS
// ============================================================

export const VALID_WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  planning: ["running", "cancelled", "failed"],
  running: ["paused", "reviewing", "pr_open", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  reviewing: ["pr_open", "running", "failed", "cancelled"],
  pr_open: ["merged", "running", "failed", "cancelled"],
  merged: [],
  failed: ["running", "cancelled"],
  cancelled: [],
};

export const VALID_STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ["running", "skipped"],
  running: ["complete", "failed", "skipped"],
  complete: [],
  failed: ["pending", "running"],
  skipped: ["pending"],
};

// ============================================================
// DEFAULTS FACTORY
// ============================================================

export function defaultPolicies(): WorkflowPolicies {
  return {
    branchPrefixes: {
      feature: "feat/",
      fix: "fix/",
      chore: "chore/",
      refactor: "refactor/",
    },
    pr: {
      requireReview: true,
      minReviewScore: 70,
      requireTests: false,
      maxFilesChanged: 50,
      labels: [],
      assignees: [],
    },
    sessions: {
      maxConcurrent: 2,
      maxTokensPerStep: 200_000,
      maxTokensPerWorkflow: 1_000_000,
      timeoutMs: 600_000,
      allowedModes: ["Claude"],
    },
    commits: {
      conventionalCommits: true,
      signOff: false,
      maxMessageLength: 72,
    },
    safety: {
      protectedBranches: ["main", "master", "production"],
      requireApprovalForForceOps: true,
      maxDeletionsPerPR: 500,
    },
  };
}
