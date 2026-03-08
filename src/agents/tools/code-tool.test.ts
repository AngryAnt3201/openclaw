import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock calls are hoisted — factories must not reference outer variables.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    writeFile: vi.fn((...args: unknown[]) => (actual.writeFile as Function)(...args)),
  };
});

// Import after mocks are established.
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createCodeTool } from "./code-tool.js";

const execFileMock = vi.mocked(execFile);
const writeFileMock = vi.mocked(writeFile);

describe("code-tool", () => {
  const tool = createCodeTool();

  beforeEach(() => {
    execFileMock.mockReset();
    writeFileMock.mockClear();
  });

  function setupExecFile(stdout = "", stderr = "", code: number | null = 0) {
    execFileMock.mockImplementation(((
      _bin: unknown,
      _args: unknown,
      _opts: unknown,
      cb: unknown,
    ) => {
      const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
      const err = code !== 0 ? Object.assign(new Error("fail"), { code }) : null;
      callback(err, stdout, stderr);
    }) as typeof execFile);
  }

  describe("uses execFile instead of exec (issue #7)", () => {
    it("calls execFile with binary and args array for javascript", async () => {
      setupExecFile("hello\n");
      await tool.execute("t1", { language: "javascript", code: "console.log('hello')" });

      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [bin, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
      expect(bin).toBe("node");
      expect(Array.isArray(args)).toBe(true);
      expect(args).toHaveLength(1);
      expect(args[0]).toMatch(/script\.mjs$/);
    });

    it("calls execFile with binary and args array for typescript", async () => {
      setupExecFile("");
      await tool.execute("t2", { language: "typescript", code: "console.log('ts')" });

      const [bin, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
      expect(bin).toBe("npx");
      expect(args[0]).toBe("tsx");
      expect(args[1]).toMatch(/script\.ts$/);
    });

    it("calls execFile with binary and args array for python", async () => {
      setupExecFile("");
      await tool.execute("t3", { language: "python", code: "print('hi')" });

      const [bin, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
      expect(bin).toBe("python3");
      expect(args).toHaveLength(1);
    });

    it("calls execFile with binary and args array for go", async () => {
      setupExecFile("");
      await tool.execute("t4", { language: "go", code: "package main" });

      const [bin, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
      expect(bin).toBe("go");
      expect(args[0]).toBe("run");
      expect(args[1]).toMatch(/script\.go$/);
    });

    it("does not pass command as a single shell string", async () => {
      setupExecFile("");
      await tool.execute("t5", { language: "javascript", code: "1+1" });

      const [bin, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
      // Binary should be a bare name with no spaces (not a shell command string)
      expect(bin).not.toContain(" ");
      // Args should be an array, not a string
      expect(Array.isArray(args)).toBe(true);
    });

    it("shell metacharacters in file path are not interpreted", async () => {
      setupExecFile("safe\n");
      // Code content with shell metacharacters — irrelevant since execFile skips shell
      const maliciousCode = '$(rm -rf /) && echo "pwned"';
      await tool.execute("t6", { language: "javascript", code: maliciousCode });

      const [bin, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
      expect(bin).toBe("node");
      expect(args).toHaveLength(1);
      // The arg is just a file path, no shell metacharacters from code content
      expect(args[0]).not.toContain("$");
      expect(args[0]).not.toContain("rm");
    });
  });

  describe("temp file permissions (issue #15)", () => {
    it("creates temp files with mode 0o600", async () => {
      setupExecFile("");
      await tool.execute("t7", { language: "javascript", code: "1" });

      expect(writeFileMock).toHaveBeenCalledTimes(1);
      const [, , opts] = writeFileMock.mock.calls[0] as unknown as [
        string,
        string,
        { encoding: string; mode: number },
      ];
      expect(opts).toEqual({ encoding: "utf-8", mode: 0o600 });
    });

    it("does not use world-readable default permissions", async () => {
      setupExecFile("");
      await tool.execute("t8", { language: "bash", code: "echo test" });

      const [, , opts] = writeFileMock.mock.calls[0] as unknown as [
        string,
        string,
        { encoding: string; mode: number },
      ];
      // 0o600 = owner read+write only, no group/other access
      expect(opts.mode).toBe(0o600);
      expect(opts.mode & 0o077).toBe(0); // no group/other bits set
    });
  });

  describe("unsupported language", () => {
    it("returns error for unknown language", async () => {
      const result = await tool.execute("t9", { language: "cobol", code: "DISPLAY 'HI'" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.exitCode).toBe(1);
      expect(parsed.stderr).toContain("Unsupported language");
    });
  });

  describe("execution results", () => {
    it("returns stdout and stderr from execFile", async () => {
      setupExecFile("output line\n", "warn line\n", 0);
      const result = await tool.execute("t10", { language: "javascript", code: "1" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.stdout).toBe("output line\n");
      expect(parsed.stderr).toBe("warn line\n");
      expect(parsed.exitCode).toBe(0);
    });

    it("parses JSON stdout as structured result", async () => {
      setupExecFile('{"key":"value"}\n', "", 0);
      const result = await tool.execute("t11", { language: "javascript", code: "1" });
      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.result).toEqual({ key: "value" });
    });

    it("passes PIPELINE_VARS env when variables provided", async () => {
      setupExecFile("");
      await tool.execute("t12", {
        language: "javascript",
        code: "1",
        variables: { foo: "bar" },
      });

      const [, , opts] = execFileMock.mock.calls[0] as unknown as [
        string,
        string[],
        { env: Record<string, string> },
      ];
      expect(opts.env.PIPELINE_VARS).toBe('{"foo":"bar"}');
    });
  });
});
