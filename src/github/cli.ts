// ---------------------------------------------------------------------------
// GitHub Integration – Thin wrapper over `gh` CLI
// ---------------------------------------------------------------------------
// All GitHub and git operations use `gh` CLI and `git` directly via
// child_process.execFile. GH_PROMPT_DISABLED=1 prevents interactive prompts.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  PRReference,
  PRCheck,
  PRCreateInput,
  PRUpdateInput,
  PRFilter,
  GitHubIssue,
  IssueCreateInput,
  IssueUpdateInput,
  IssueFilter,
  RepoContext,
  FileChange,
} from "./types.js";

const exec = promisify(execFile);

const GH_ENV = { ...process.env, GH_PROMPT_DISABLED: "1" };

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gh(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<string> {
  const { stdout } = await exec("gh", args, {
    env: GH_ENV,
    cwd: opts?.cwd,
    timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function ghJson<T>(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<T> {
  const raw = await gh(args, opts);
  return JSON.parse(raw) as T;
}

async function git(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<string> {
  const { stdout } = await exec("git", args, {
    env: process.env,
    cwd: opts?.cwd,
    timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function isoToMs(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// ---------------------------------------------------------------------------
// Repo Context
// ---------------------------------------------------------------------------

export async function resolveRepoContext(repoPath: string): Promise<RepoContext> {
  const remote = await git(["remote", "get-url", "origin"], { cwd: repoPath });
  // Parse owner/name from remote URL
  // Handles: git@github.com:owner/name.git and https://github.com/owner/name.git
  const match = remote.match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Cannot parse GitHub owner/name from remote: ${remote}`);
  }
  return {
    path: repoPath,
    remote: "origin",
    remoteUrl: remote,
    owner: match[1]!,
    name: match[2]!,
  };
}

// ---------------------------------------------------------------------------
// Git Operations
// ---------------------------------------------------------------------------

export async function getCurrentBranch(cwd: string): Promise<string> {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
}

export async function createBranch(
  cwd: string,
  branchName: string,
  baseBranch: string,
): Promise<void> {
  await git(["checkout", "-b", branchName, baseBranch], { cwd });
}

export async function pushBranch(
  cwd: string,
  branchName: string,
  opts?: { force?: boolean },
): Promise<void> {
  const args = ["push", "-u", "origin", branchName];
  if (opts?.force) {
    args.splice(1, 0, "--force-with-lease");
  }
  await git(args, { cwd });
}

export async function getCommitLog(cwd: string, base: string, head?: string): Promise<string[]> {
  const range = head ? `${base}..${head}` : `${base}..HEAD`;
  const raw = await git(["log", "--oneline", range], { cwd });
  return raw ? raw.split("\n") : [];
}

export async function getDiffStat(cwd: string, base: string, head?: string): Promise<FileChange[]> {
  const range = head ? `${base}..${head}` : `${base}..HEAD`;
  const raw = await git(["diff", "--numstat", "--diff-filter=AMDRT", range], { cwd });
  if (!raw) {
    return [];
  }

  const statusRaw = await git(["diff", "--name-status", "--diff-filter=AMDRT", range], { cwd });
  const statusMap = new Map<string, string>();
  for (const line of statusRaw.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const statusChar = parts[0]!.charAt(0);
      const fileName = parts[parts.length - 1]!;
      statusMap.set(fileName, statusChar);
    }
  }

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [addStr, delStr, filePath] = line.split("\t");
      const additions = addStr === "-" ? 0 : parseInt(addStr!, 10) || 0;
      const deletions = delStr === "-" ? 0 : parseInt(delStr!, 10) || 0;
      const statusChar = statusMap.get(filePath!) ?? "M";
      const status: FileChange["status"] =
        statusChar === "A"
          ? "added"
          : statusChar === "D"
            ? "deleted"
            : statusChar === "R"
              ? "renamed"
              : "modified";
      return { path: filePath!, status, additions, deletions };
    });
}

// ---------------------------------------------------------------------------
// PR Operations
// ---------------------------------------------------------------------------

type GhPR = {
  number: number;
  url: string;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusCheckRollup?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    detailsUrl: string | null;
  }>;
};

const PR_FIELDS = [
  "number",
  "url",
  "title",
  "body",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
  "additions",
  "deletions",
  "changedFiles",
  "reviewDecision",
  "mergedAt",
  "createdAt",
  "updatedAt",
  "statusCheckRollup",
].join(",");

function mapPR(raw: GhPR): PRReference {
  const state: PRReference["state"] = raw.isDraft
    ? "draft"
    : raw.state === "MERGED"
      ? "merged"
      : raw.state === "CLOSED"
        ? "closed"
        : "open";

  const reviewState: PRReference["reviewState"] =
    raw.reviewDecision === "APPROVED"
      ? "approved"
      : raw.reviewDecision === "CHANGES_REQUESTED"
        ? "changes_requested"
        : "pending";

  const checks: PRCheck[] = (raw.statusCheckRollup ?? []).map((c) => ({
    name: c.name,
    status: (c.status?.toLowerCase() ?? "queued") as PRCheck["status"],
    conclusion: c.conclusion?.toLowerCase() as PRCheck["conclusion"],
    url: c.detailsUrl ?? undefined,
  }));

  return {
    number: raw.number,
    url: raw.url,
    title: raw.title,
    body: raw.body ?? "",
    state,
    headBranch: raw.headRefName,
    baseBranch: raw.baseRefName,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    filesChanged: raw.changedFiles ?? 0,
    checks,
    reviewState,
    mergedAtMs: isoToMs(raw.mergedAt),
    createdAtMs: isoToMs(raw.createdAt),
    updatedAtMs: isoToMs(raw.updatedAt),
  };
}

export async function createPR(input: PRCreateInput): Promise<PRReference> {
  const args = [
    "pr",
    "create",
    "--repo",
    `${input.owner}/${input.repo}`,
    "--title",
    input.title,
    "--body",
    input.body,
    "--head",
    input.head,
    "--base",
    input.base,
  ];
  if (input.draft !== false) {
    args.push("--draft");
  }
  if (input.labels?.length) {
    args.push("--label", input.labels.join(","));
  }
  if (input.assignees?.length) {
    args.push("--assignee", input.assignees.join(","));
  }
  const url = await gh(args);
  // gh pr create returns the URL; fetch full details
  const prNumber = parseInt(url.split("/").pop()!, 10);
  return getPR(input.owner, input.repo, prNumber);
}

export async function getPR(owner: string, repo: string, number: number): Promise<PRReference> {
  const raw = await ghJson<GhPR>([
    "pr",
    "view",
    String(number),
    "--repo",
    `${owner}/${repo}`,
    "--json",
    PR_FIELDS,
  ]);
  return mapPR(raw);
}

export async function listPRs(
  owner: string,
  repo: string,
  filter?: PRFilter,
): Promise<PRReference[]> {
  const args = ["pr", "list", "--repo", `${owner}/${repo}`, "--json", PR_FIELDS];
  if (filter?.state) {
    args.push("--state", filter.state === "merged" ? "merged" : filter.state);
  }
  if (filter?.labels?.length) {
    args.push("--label", filter.labels.join(","));
  }
  if (filter?.limit) {
    args.push("--limit", String(filter.limit));
  }
  const raw = await ghJson<GhPR[]>(args);
  return raw.map(mapPR);
}

export async function updatePR(input: PRUpdateInput): Promise<PRReference> {
  const args = ["pr", "edit", String(input.number), "--repo", `${input.owner}/${input.repo}`];
  if (input.title) {
    args.push("--title", input.title);
  }
  if (input.body) {
    args.push("--body", input.body);
  }
  if (input.labels?.length) {
    args.push("--add-label", input.labels.join(","));
  }
  await gh(args);
  return getPR(input.owner, input.repo, input.number);
}

export async function mergePR(
  owner: string,
  repo: string,
  number: number,
  method?: string,
): Promise<void> {
  const args = ["pr", "merge", String(number), "--repo", `${owner}/${repo}`];
  const mergeMethod = method ?? "squash";
  args.push(`--${mergeMethod}`);
  args.push("--delete-branch");
  await gh(args);
}

export async function getPRChecks(owner: string, repo: string, number: number): Promise<PRCheck[]> {
  const pr = await getPR(owner, repo, number);
  return pr.checks;
}

export async function commentOnPR(
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<void> {
  await gh(["pr", "comment", String(number), "--repo", `${owner}/${repo}`, "--body", body]);
}

export async function getPRDiff(owner: string, repo: string, number: number): Promise<string> {
  return gh(["pr", "diff", String(number), "--repo", `${owner}/${repo}`]);
}

// ---------------------------------------------------------------------------
// Issue Operations
// ---------------------------------------------------------------------------

type GhIssue = {
  number: number;
  url: string;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  milestone?: { title: string } | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

const ISSUE_FIELDS = [
  "number",
  "url",
  "title",
  "body",
  "state",
  "labels",
  "assignees",
  "milestone",
  "createdAt",
  "updatedAt",
  "closedAt",
].join(",");

function mapIssue(raw: GhIssue): GitHubIssue {
  return {
    number: raw.number,
    url: raw.url,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state === "CLOSED" ? "closed" : "open",
    labels: (raw.labels ?? []).map((l) => l.name),
    assignees: (raw.assignees ?? []).map((a) => a.login),
    milestone: raw.milestone?.title,
    linkedPRs: [],
    createdAtMs: isoToMs(raw.createdAt),
    updatedAtMs: isoToMs(raw.updatedAt),
    closedAtMs: isoToMs(raw.closedAt),
  };
}

export async function createIssue(input: IssueCreateInput): Promise<GitHubIssue> {
  const args = [
    "issue",
    "create",
    "--repo",
    `${input.owner}/${input.repo}`,
    "--title",
    input.title,
    "--body",
    input.body,
  ];
  if (input.labels?.length) {
    args.push("--label", input.labels.join(","));
  }
  if (input.assignees?.length) {
    args.push("--assignee", input.assignees.join(","));
  }
  if (input.milestone) {
    args.push("--milestone", String(input.milestone));
  }
  const url = await gh(args);
  const issueNumber = parseInt(url.split("/").pop()!, 10);
  return getIssue(input.owner, input.repo, issueNumber);
}

export async function getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue> {
  const raw = await ghJson<GhIssue>([
    "issue",
    "view",
    String(number),
    "--repo",
    `${owner}/${repo}`,
    "--json",
    ISSUE_FIELDS,
  ]);
  return mapIssue(raw);
}

export async function listIssues(
  owner: string,
  repo: string,
  filter?: IssueFilter,
): Promise<GitHubIssue[]> {
  const args = ["issue", "list", "--repo", `${owner}/${repo}`, "--json", ISSUE_FIELDS];
  if (filter?.state) {
    args.push("--state", filter.state);
  }
  if (filter?.labels?.length) {
    args.push("--label", filter.labels.join(","));
  }
  if (filter?.limit) {
    args.push("--limit", String(filter.limit));
  }
  const raw = await ghJson<GhIssue[]>(args);
  return raw.map(mapIssue);
}

export async function updateIssue(input: IssueUpdateInput): Promise<GitHubIssue> {
  const args = ["issue", "edit", String(input.number), "--repo", `${input.owner}/${input.repo}`];
  if (input.title) {
    args.push("--title", input.title);
  }
  if (input.body) {
    args.push("--body", input.body);
  }
  if (input.labels?.length) {
    args.push("--add-label", input.labels.join(","));
  }
  await gh(args);
  return getIssue(input.owner, input.repo, input.number);
}

export async function closeIssue(
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubIssue> {
  await gh(["issue", "close", String(number), "--repo", `${owner}/${repo}`]);
  return getIssue(owner, repo, number);
}

export async function commentOnIssue(
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<void> {
  await gh(["issue", "comment", String(number), "--repo", `${owner}/${repo}`, "--body", body]);
}
