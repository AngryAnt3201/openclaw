// ---------------------------------------------------------------------------
// GitHub Integration Types — PR, Issue, and Review types
// ---------------------------------------------------------------------------
// Extracted from the legacy workflow types. These are used by the `gh` CLI
// wrapper (cli.ts) and the gateway PR/issue RPC handlers.
// ---------------------------------------------------------------------------

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

export interface RepoContext {
  path: string;
  remote: string;
  remoteUrl: string;
  owner: string;
  name: string;
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  oldPath?: string;
}

// Filters
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

// CRUD inputs
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
