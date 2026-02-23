import { describe, expect, it, vi } from "vitest";
import type { KBService } from "../service.js";
import { syncCodeArtifactToKB, type CodeArtifact } from "./code-artifact.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockArtifact(overrides?: Partial<CodeArtifact>): CodeArtifact {
  return {
    type: "pull-request",
    repo: "miranda",
    identifier: "42",
    title: "Add OAuth2 authentication",
    body: "Added OAuth2 with JWT token rotation.",
    author: "agent-main",
    state: "open",
    branch: "feature/auth",
    createdAtMs: new Date("2026-02-15T11:00:00Z").getTime(),
    ...overrides,
  };
}

function mockKBService() {
  return {
    create: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue(null),
  } as unknown as KBService & {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncCodeArtifactToKB", () => {
  it("creates a code note via upsert", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact(), svc);

    expect(svc.create).toHaveBeenCalledTimes(1);
  });

  it("uses PR- prefix for pull requests with _miranda prefix", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_miranda/code/PR-miranda-42.md");
  });

  it("uses ISSUE- prefix for issues", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact({ type: "issue", identifier: "38" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_miranda/code/ISSUE-miranda-38.md");
  });

  it("uses COMMIT- prefix for commits", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact({ type: "commit", identifier: "e34996d" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_miranda/code/COMMIT-miranda-e34996d.md");
  });

  it("includes PR title with number in heading", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("# PR #42: Add OAuth2 authentication");
  });

  it("includes frontmatter with type, repo, state, author", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toMatch(/^---\n/);
    expect(createCall.content).toContain("type: pull-request");
    expect(createCall.content).toContain("repo: miranda");
    expect(createCall.content).toContain("state: open");
    expect(createCall.content).toContain("author: agent-main");
  });

  it("includes file changes in body", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(
      mockArtifact({
        changes: [
          { path: "auth/service.ts", additions: 145, deletions: 0 },
          { path: "package.json", additions: 2, deletions: 0 },
        ],
      }),
      svc,
    );

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("## Changes");
    expect(createCall.content).toContain("`auth/service.ts` (+145 -0)");
    expect(createCall.content).toContain("`package.json` (+2 -0)");
  });

  it("includes task wikilink when taskId is provided", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact({ taskId: "abc12345-defg-6789-hijk-lmnop" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("[[TASK-abc12345]]");
  });

  it("includes branch in frontmatter and body", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(mockArtifact({ branch: "feature/auth" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("branch: feature/auth");
    expect(createCall.content).toContain("**Branch:** `feature/auth`");
  });

  it("formats commit heading with short hash", async () => {
    const svc = mockKBService();

    await syncCodeArtifactToKB(
      mockArtifact({
        type: "commit",
        identifier: "e34996d1234567890",
        title: "fix: Open web-embed apps in system browser",
      }),
      svc,
    );

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain(
      "# Commit e34996d: fix: Open web-embed apps in system browser",
    );
  });
});
