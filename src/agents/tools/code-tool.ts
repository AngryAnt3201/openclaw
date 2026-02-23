// ---------------------------------------------------------------------------
// Code Execution Agent Tool – write and run code in any language
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";

const LANGUAGE_RUNNERS: Record<string, { ext: string; cmd: (f: string) => string }> = {
  javascript: { ext: ".mjs", cmd: (f) => `node ${f}` },
  typescript: { ext: ".ts", cmd: (f) => `npx tsx ${f}` },
  python: { ext: ".py", cmd: (f) => `python3 ${f}` },
  bash: { ext: ".sh", cmd: (f) => `bash ${f}` },
  ruby: { ext: ".rb", cmd: (f) => `ruby ${f}` },
  go: { ext: ".go", cmd: (f) => `go run ${f}` },
};

const CodeToolSchema = Type.Object({
  language: Type.String({
    description: "Programming language: javascript, typescript, python, bash, ruby, go",
  }),
  code: Type.String({ description: "The code to execute" }),
  variables: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Variables to inject as PIPELINE_VARS environment variable (JSON)",
    }),
  ),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default 30)" })),
});

export function createCodeTool(): AnyAgentTool {
  return {
    label: "Execute Code",
    name: "execute_code",
    description:
      "Write and execute code in any supported language (JavaScript, TypeScript, Python, Bash, Ruby, Go). " +
      "Variables from the pipeline context can be passed in and will be available as PIPELINE_VARS environment variable (JSON). " +
      "Returns stdout, stderr, and exit code.",
    parameters: CodeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const language = readStringParam(params, "language", { required: true }).toLowerCase();
      const code = readStringParam(params, "code", { required: true });
      const timeout = readNumberParam(params, "timeout") ?? 30;
      const variables = params.variables as Record<string, unknown> | undefined;

      const runner = LANGUAGE_RUNNERS[language];
      if (!runner) {
        return jsonResult({
          exitCode: 1,
          stdout: "",
          stderr: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_RUNNERS).join(", ")}`,
        });
      }

      // Write code to temp file.
      const tmpDir = await mkdtemp(join(tmpdir(), "openclaw-code-"));
      const filePath = join(tmpDir, `script${runner.ext}`);
      await writeFile(filePath, code, "utf-8");

      try {
        const result = await new Promise<{
          stdout: string;
          stderr: string;
          exitCode: number;
        }>((resolve) => {
          const env = {
            ...process.env,
            ...(variables ? { PIPELINE_VARS: JSON.stringify(variables) } : {}),
          };

          exec(
            runner.cmd(filePath),
            {
              timeout: timeout * 1000,
              maxBuffer: 1024 * 1024, // 1MB
              env,
            },
            (error, stdout, stderr) => {
              resolve({
                stdout: stdout?.toString() ?? "",
                stderr: stderr?.toString() ?? "",
                exitCode: error?.code ?? (error ? 1 : 0),
              });
            },
          );
        });

        // Try to parse stdout as JSON for structured output.
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.stdout.trim());
        } catch {
          parsed = undefined;
        }

        return jsonResult({
          ...result,
          ...(parsed !== undefined ? { result: parsed } : {}),
        });
      } finally {
        // Cleanup temp file.
        await unlink(filePath).catch(() => {});
      }
    },
  };
}
