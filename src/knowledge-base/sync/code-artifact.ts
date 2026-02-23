// ---------------------------------------------------------------------------
// Code Artifact → KB Sync – syncs PRs, issues, commits to KB notes
// ---------------------------------------------------------------------------

import type { KBService } from "../service.js";
import { serializeFrontmatter } from "../metadata-parser.js";

const CODE_NOTE_PREFIX = "_miranda/code";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodeArtifactType = "pull-request" | "issue" | "commit";

export type CodeFileChange = {
  path: string;
  additions: number;
  deletions: number;
};

export type CodeArtifact = {
  type: CodeArtifactType;
  repo: string;
  identifier: string; // PR number, issue number, or commit hash
  title: string;
  body?: string;
  author: string;
  state?: string; // open, closed, merged
  branch?: string;
  changes?: CodeFileChange[];
  createdAtMs: number;
  taskId?: string;
  tags?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function codeNotePath(artifact: CodeArtifact): string {
  const prefix =
    artifact.type === "pull-request" ? "PR" : artifact.type === "issue" ? "ISSUE" : "COMMIT";
  return `${CODE_NOTE_PREFIX}/${prefix}-${artifact.repo}-${artifact.identifier}.md`;
}

function formatCodeBody(artifact: CodeArtifact): string {
  const lines: string[] = [];

  const typeLabel =
    artifact.type === "pull-request"
      ? `PR #${artifact.identifier}`
      : artifact.type === "issue"
        ? `Issue #${artifact.identifier}`
        : `Commit ${artifact.identifier.slice(0, 7)}`;

  lines.push(`# ${typeLabel}: ${artifact.title}`);
  lines.push("");

  // Body / description
  if (artifact.body) {
    lines.push("## Description");
    lines.push("");
    lines.push(artifact.body);
    lines.push("");
  }

  // State
  if (artifact.state) {
    lines.push(`**State:** ${artifact.state}`);
    lines.push(`**Author:** ${artifact.author}`);
    if (artifact.branch) {
      lines.push(`**Branch:** \`${artifact.branch}\``);
    }
    lines.push("");
  }

  // Changes
  if (artifact.changes && artifact.changes.length > 0) {
    lines.push("## Changes");
    lines.push("");
    for (const change of artifact.changes) {
      lines.push(`- \`${change.path}\` (+${change.additions} -${change.deletions})`);
    }
    lines.push("");
  }

  // Related
  const related: string[] = [];
  if (artifact.taskId) {
    related.push(`- Task: [[TASK-${artifact.taskId.slice(0, 8)}]]`);
  }

  if (related.length > 0) {
    lines.push("## Related");
    lines.push("");
    lines.push(...related);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function syncCodeArtifactToKB(
  artifact: CodeArtifact,
  kbService: KBService,
): Promise<void> {
  const notePath = codeNotePath(artifact);
  const date = new Date(artifact.createdAtMs).toISOString().slice(0, 10);

  const frontmatter: Record<string, unknown> = {
    type: artifact.type,
    repo: artifact.repo,
    identifier: artifact.identifier,
    state: artifact.state ?? "unknown",
    author: artifact.author,
    date,
    tags: ["code", artifact.type, artifact.repo, ...(artifact.tags ?? [])],
  };

  if (artifact.branch) {
    frontmatter.branch = artifact.branch;
  }
  if (artifact.taskId) {
    frontmatter.taskId = artifact.taskId;
  }

  const body = formatCodeBody(artifact);
  const content = serializeFrontmatter(frontmatter, body);

  // KBService.create() is upsert – it overwrites if the note already exists
  await kbService.create({ path: notePath, content });
}
