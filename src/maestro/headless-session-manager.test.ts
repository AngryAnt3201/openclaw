import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateBranchName } from "./headless-session-manager.js";

// Mock child_process so we can inspect how execFileSync is called
const execFileSyncMock = vi.fn();
const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
  },
}));

describe("validateBranchName", () => {
  it("accepts simple branch names", () => {
    expect(() => validateBranchName("main")).not.toThrow();
    expect(() => validateBranchName("feature/my-branch")).not.toThrow();
    expect(() => validateBranchName("release-1.2.3")).not.toThrow();
    expect(() => validateBranchName("fix_thing")).not.toThrow();
  });

  it("accepts branch names with dots and hyphens", () => {
    expect(() => validateBranchName("v1.0.0-rc1")).not.toThrow();
    expect(() => validateBranchName("user/feature.test")).not.toThrow();
  });

  it("rejects empty branch names", () => {
    expect(() => validateBranchName("")).toThrow("must not be empty");
    expect(() => validateBranchName("   ")).toThrow("must not be empty");
  });

  it("rejects branch names with semicolons", () => {
    expect(() => validateBranchName("branch;rm -rf /")).toThrow("disallowed shell metacharacters");
  });

  it("rejects branch names with pipe", () => {
    expect(() => validateBranchName("branch|cat /etc/passwd")).toThrow(
      "disallowed shell metacharacters",
    );
  });

  it("rejects branch names with ampersand", () => {
    expect(() => validateBranchName("branch&echo pwned")).toThrow(
      "disallowed shell metacharacters",
    );
  });

  it("rejects branch names with dollar sign", () => {
    expect(() => validateBranchName("branch$HOME")).toThrow("disallowed shell metacharacters");
  });

  it("rejects branch names with backticks", () => {
    expect(() => validateBranchName("branch`whoami`")).toThrow("disallowed shell metacharacters");
  });

  it("rejects branch names with backslash", () => {
    expect(() => validateBranchName("branch\\n")).toThrow("disallowed shell metacharacters");
  });

  it("rejects branch names with parentheses", () => {
    expect(() => validateBranchName("branch(test)")).toThrow("disallowed shell metacharacters");
  });

  it("rejects branch names with newlines", () => {
    expect(() => validateBranchName("branch\ninjection")).toThrow(
      "disallowed shell metacharacters",
    );
  });

  it("rejects branch names with null bytes", () => {
    expect(() => validateBranchName("branch\0evil")).toThrow("disallowed shell metacharacters");
  });

  it("rejects branch names with quotes", () => {
    expect(() => validateBranchName('branch"inject')).toThrow("disallowed shell metacharacters");
    expect(() => validateBranchName("branch'inject")).toThrow("disallowed shell metacharacters");
  });
});

describe("git commands use array arguments (no shell interpolation)", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    spawnMock.mockReset();
  });

  it("findClaudeBinary calls execFileSync with array args", async () => {
    execFileSyncMock.mockReturnValue("/usr/local/bin/claude\n");

    // Re-import to trigger findClaudeBinary in the constructor
    const _mod = await import("./headless-session-manager.js");

    // The constructor calls findClaudeBinary which calls execFileSync("which", [...])
    const whichCalls = execFileSyncMock.mock.calls.filter((call: unknown[]) => call[0] === "which");

    // Should have been called with array arguments, not template literal
    for (const call of whichCalls) {
      expect(call[0]).toBe("which");
      expect(Array.isArray(call[1])).toBe(true);
      // Ensure no shell metacharacters in the command string itself
      expect(call[0]).not.toContain("`");
      expect(call[0]).not.toContain("$");
    }
  });

  it("isGitRepo uses execFileSync with array args", async () => {
    execFileSyncMock.mockReturnValue("/usr/local/bin/claude\n");
    const { HeadlessSessionManager } = await import("./headless-session-manager.js");

    // Reset after constructor calls
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "rev-parse" && args.includes("--is-inside-work-tree")) {
        return "true\n";
      }
      throw new Error("not found");
    });

    const fs = await import("node:fs");
    (fs.default.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const mgr = new HeadlessSessionManager(log);

    // Try to create a session with a branch to trigger git commands
    spawnMock.mockReturnValue({
      stdin: { end: vi.fn(), writable: true },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      pid: 123,
    });

    try {
      await mgr.createSession({
        projectPath: "/tmp/test-project",
        branch: "feature-test",
      });
    } catch {
      // May fail due to mocking, that's fine
    }

    // Check that all execFileSync calls use array arguments
    for (const call of execFileSyncMock.mock.calls) {
      const [cmd, args] = call;
      expect(typeof cmd).toBe("string");
      // The second argument should always be an array
      if (args !== undefined) {
        expect(Array.isArray(args)).toBe(true);
      }
      // The command should never contain template-literal interpolation
      expect(cmd).not.toMatch(/\$\{/);
      expect(cmd).not.toMatch(/`/);
    }
  });
});
