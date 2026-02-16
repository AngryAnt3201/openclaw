import { describe, expect, it, vi, beforeEach } from "vitest";

// We mock child_process.execFile to avoid requiring gh CLI and git repos
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));
vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return {
    ...actual,
    promisify: () => mockExecFile,
  };
});

// Re-import after mocks
const github = await import("./github.js");

function mockExecResult(stdout: string) {
  mockExecFile.mockResolvedValueOnce({ stdout, stderr: "" });
}

function mockExecJsonResult(data: unknown) {
  mockExecResult(JSON.stringify(data));
}

beforeEach(() => {
  mockExecFile.mockReset();
});

// ---------------------------------------------------------------------------
// resolveRepoContext
// ---------------------------------------------------------------------------

describe("resolveRepoContext", () => {
  it("parses SSH remote URL", async () => {
    mockExecResult("git@github.com:owner/repo.git");
    const ctx = await github.resolveRepoContext("/tmp/repo");
    expect(ctx.owner).toBe("owner");
    expect(ctx.name).toBe("repo");
    expect(ctx.remote).toBe("origin");
  });

  it("parses HTTPS remote URL", async () => {
    mockExecResult("https://github.com/myorg/myproject.git");
    const ctx = await github.resolveRepoContext("/tmp/repo");
    expect(ctx.owner).toBe("myorg");
    expect(ctx.name).toBe("myproject");
  });

  it("parses HTTPS URL without .git suffix", async () => {
    mockExecResult("https://github.com/owner/name");
    const ctx = await github.resolveRepoContext("/tmp");
    expect(ctx.owner).toBe("owner");
    expect(ctx.name).toBe("name");
  });

  it("throws for unparseable remote", async () => {
    mockExecResult("not-a-url");
    await expect(github.resolveRepoContext("/tmp")).rejects.toThrow(
      "Cannot parse GitHub owner/name",
    );
  });
});

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

describe("getCurrentBranch", () => {
  it("returns branch name", async () => {
    mockExecResult("feat/my-branch");
    const branch = await github.getCurrentBranch("/tmp/repo");
    expect(branch).toBe("feat/my-branch");
  });
});

describe("createBranch", () => {
  it("calls git checkout -b", async () => {
    mockExecResult("");
    await github.createBranch("/tmp/repo", "feat/new", "main");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["checkout", "-b", "feat/new", "main"],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });
});

describe("pushBranch", () => {
  it("pushes with -u origin", async () => {
    mockExecResult("");
    await github.pushBranch("/tmp/repo", "feat/test");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["push", "-u", "origin", "feat/test"],
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });

  it("adds --force-with-lease when force=true", async () => {
    mockExecResult("");
    await github.pushBranch("/tmp/repo", "feat/test", { force: true });
    const args = mockExecFile.mock.calls[0]![1] as string[];
    expect(args).toContain("--force-with-lease");
  });
});

describe("getCommitLog", () => {
  it("parses commit lines", async () => {
    mockExecResult("abc123 First commit\ndef456 Second commit");
    const log = await github.getCommitLog("/tmp/repo", "main");
    expect(log).toHaveLength(2);
    expect(log[0]).toBe("abc123 First commit");
  });

  it("returns empty for no output", async () => {
    mockExecResult("");
    const log = await github.getCommitLog("/tmp/repo", "main");
    expect(log).toHaveLength(0);
  });
});

describe("getDiffStat", () => {
  it("parses numstat output", async () => {
    mockExecResult("10\t5\tsrc/file.ts\n0\t3\tsrc/old.ts");
    // Second call for name-status
    mockExecResult("M\tsrc/file.ts\nD\tsrc/old.ts");

    const changes = await github.getDiffStat("/tmp/repo", "main");
    expect(changes).toHaveLength(2);
    expect(changes[0]!.path).toBe("src/file.ts");
    expect(changes[0]!.additions).toBe(10);
    expect(changes[0]!.deletions).toBe(5);
    expect(changes[0]!.status).toBe("modified");
    expect(changes[1]!.status).toBe("deleted");
  });
});

// ---------------------------------------------------------------------------
// PR operations
// ---------------------------------------------------------------------------

describe("getPR", () => {
  it("maps gh JSON output to PRReference", async () => {
    mockExecJsonResult({
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "Test PR",
      body: "Description",
      state: "OPEN",
      isDraft: false,
      headRefName: "feat/test",
      baseRefName: "main",
      additions: 10,
      deletions: 5,
      changedFiles: 3,
      reviewDecision: "APPROVED",
      mergedAt: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      statusCheckRollup: [
        { name: "CI", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: null },
      ],
    });

    const pr = await github.getPR("o", "r", 42);
    expect(pr.number).toBe(42);
    expect(pr.state).toBe("open");
    expect(pr.reviewState).toBe("approved");
    expect(pr.checks).toHaveLength(1);
    expect(pr.checks[0]!.conclusion).toBe("success");
    expect(pr.createdAtMs).toBeGreaterThan(0);
  });

  it("handles draft PR", async () => {
    mockExecJsonResult({
      number: 1,
      url: "",
      title: "",
      body: "",
      state: "OPEN",
      isDraft: true,
      headRefName: "feat/x",
      baseRefName: "main",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      reviewDecision: "",
      mergedAt: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    const pr = await github.getPR("o", "r", 1);
    expect(pr.state).toBe("draft");
  });

  it("handles merged PR", async () => {
    mockExecJsonResult({
      number: 2,
      url: "",
      title: "",
      body: "",
      state: "MERGED",
      isDraft: false,
      headRefName: "feat/y",
      baseRefName: "main",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      reviewDecision: "",
      mergedAt: "2024-06-01T12:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-06-01T12:00:00Z",
    });

    const pr = await github.getPR("o", "r", 2);
    expect(pr.state).toBe("merged");
    expect(pr.mergedAtMs).toBeGreaterThan(0);
  });
});

describe("listPRs", () => {
  it("returns mapped list", async () => {
    mockExecJsonResult([
      {
        number: 1,
        url: "",
        title: "PR 1",
        body: "",
        state: "OPEN",
        isDraft: false,
        headRefName: "a",
        baseRefName: "main",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        reviewDecision: "",
        mergedAt: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ]);
    const prs = await github.listPRs("o", "r");
    expect(prs).toHaveLength(1);
    expect(prs[0]!.number).toBe(1);
  });
});

describe("mergePR", () => {
  it("calls gh pr merge with squash by default", async () => {
    mockExecResult("");
    await github.mergePR("o", "r", 42);
    const args = mockExecFile.mock.calls[0]![1] as string[];
    expect(args).toContain("--squash");
    expect(args).toContain("--delete-branch");
  });

  it("uses specified merge method", async () => {
    mockExecResult("");
    await github.mergePR("o", "r", 42, "rebase");
    const args = mockExecFile.mock.calls[0]![1] as string[];
    expect(args).toContain("--rebase");
  });
});

// ---------------------------------------------------------------------------
// Issue operations
// ---------------------------------------------------------------------------

describe("getIssue", () => {
  it("maps gh JSON output to GitHubIssue", async () => {
    mockExecJsonResult({
      number: 10,
      url: "https://github.com/o/r/issues/10",
      title: "Bug report",
      body: "Something broke",
      state: "OPEN",
      labels: [{ name: "bug" }],
      assignees: [{ login: "dev" }],
      milestone: { title: "v1.0" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      closedAt: null,
    });

    const issue = await github.getIssue("o", "r", 10);
    expect(issue.number).toBe(10);
    expect(issue.state).toBe("open");
    expect(issue.labels).toEqual(["bug"]);
    expect(issue.assignees).toEqual(["dev"]);
    expect(issue.milestone).toBe("v1.0");
  });

  it("handles closed issue", async () => {
    mockExecJsonResult({
      number: 11,
      url: "",
      title: "",
      body: "",
      state: "CLOSED",
      labels: [],
      assignees: [],
      milestone: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      closedAt: "2024-01-02T00:00:00Z",
    });

    const issue = await github.getIssue("o", "r", 11);
    expect(issue.state).toBe("closed");
    expect(issue.closedAtMs).toBeGreaterThan(0);
  });
});

describe("commentOnIssue", () => {
  it("calls gh issue comment", async () => {
    mockExecResult("");
    await github.commentOnIssue("o", "r", 10, "Hello");
    const args = mockExecFile.mock.calls[0]![1] as string[];
    expect(args).toContain("comment");
    expect(args).toContain("--body");
    expect(args).toContain("Hello");
  });
});

describe("closeIssue", () => {
  it("calls gh issue close then fetches", async () => {
    // First call: close
    mockExecResult("");
    // Second call: view (getIssue)
    mockExecJsonResult({
      number: 10,
      url: "",
      title: "",
      body: "",
      state: "CLOSED",
      labels: [],
      assignees: [],
      milestone: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      closedAt: "2024-01-02T00:00:00Z",
    });
    const issue = await github.closeIssue("o", "r", 10);
    expect(issue.state).toBe("closed");
  });
});
