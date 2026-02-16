/**
 * OpenClaw tool for managing Maestro Claude Code sessions.
 *
 * Allows the agent to create sessions, check status, send input,
 * list sessions, and kill sessions via the Maestro REST API.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";
import { tryCreateMaestroClient } from "./maestro-client.js";

const MaestroSessionSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("status"),
      Type.Literal("input"),
      Type.Literal("output"),
      Type.Literal("list"),
      Type.Literal("kill"),
    ],
    { description: "The action to perform." },
  ),
  projectPath: Type.Optional(
    Type.String({ description: "Path to the project (required for 'create')." }),
  ),
  branch: Type.Optional(
    Type.String({ description: "Git branch to work on (creates worktree if needed)." }),
  ),
  prompt: Type.Optional(
    Type.String({ description: "Initial prompt for Claude Code (required for 'create')." }),
  ),
  autoPush: Type.Optional(
    Type.Boolean({
      description: "Auto-push when session finishes (default: false).",
      default: false,
    }),
  ),
  skipPermissions: Type.Optional(
    Type.Boolean({
      description:
        "Skip permission prompts (e.g. --dangerously-skip-permissions). Overrides user settings if provided.",
    }),
  ),
  customFlags: Type.Optional(
    Type.String({
      description:
        "Additional CLI flags to pass to the AI tool (e.g. '--model opus'). Overrides user settings if provided.",
    }),
  ),
  sessionId: Type.Optional(
    Type.Number({
      description: "Session ID (required for 'status', 'input', 'output', 'kill').",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description:
        "Text to send to session stdin. REQUIRED when action is 'input' — omitting this will cause an error.",
    }),
  ),
  cursor: Type.Optional(
    Type.Number({
      description: "Output cursor for incremental reads (for 'output' action).",
    }),
  ),
});

export function createMaestroSessionTool(): AnyAgentTool {
  return {
    label: "Maestro",
    name: "maestro_session",
    description:
      "Create and manage Maestro Claude Code sessions. Use this to spin up isolated Claude Code terminals that work on code, run tests, and push changes.\n\nActions:\n- create: new session (requires projectPath, prompt)\n- status: check session (requires sessionId)\n- input: send text to session stdin (requires sessionId AND text — you MUST provide the text param)\n- output: read terminal output (requires sessionId, optional cursor)\n- list: all sessions (no extra params)\n- kill: terminate session (requires sessionId)",
    parameters: MaestroSessionSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const client = tryCreateMaestroClient();
      if (!client) {
        return jsonResult({
          error:
            "Maestro is not running. Start Maestro desktop app first, or check that ~/.maestro/api-token and ~/.maestro/api-port exist.",
        });
      }

      switch (action) {
        case "create": {
          const projectPath = readStringParam(params, "projectPath", { required: true });
          const branch = readStringParam(params, "branch");
          const prompt = readStringParam(params, "prompt");
          const autoPush = params.autoPush === true;
          const skipPermissions =
            typeof params.skipPermissions === "boolean" ? params.skipPermissions : undefined;
          const customFlags = readStringParam(params, "customFlags");

          try {
            const session = await client.createSession({
              projectPath,
              branch,
              initialPrompt: prompt,
              autoPush,
              skipPermissions,
              customFlags,
            });
            return jsonResult({
              success: true,
              session_id: session.session_id,
              status: session.status,
              working_directory: session.working_directory,
              worktree_path: session.worktree_path,
              message: `Session ${session.session_id} created.${prompt ? " Claude Code will start with the given prompt." : ""}`,
            });
          } catch (err) {
            return jsonResult({ error: `Failed to create session: ${String(err)}` });
          }
        }

        case "status": {
          const sessionId = readNumberParam(params, "sessionId", {
            required: true,
            integer: true,
          })!;
          try {
            const detail = await client.getSession(sessionId);
            return jsonResult({
              id: detail.id,
              status: detail.status,
              mode: detail.mode,
              branch: detail.branch,
              project_path: detail.project_path,
              worktree_path: detail.worktree_path,
            });
          } catch (err) {
            return jsonResult({ error: `Failed to get session status: ${String(err)}` });
          }
        }

        case "input": {
          const sessionId = readNumberParam(params, "sessionId", {
            required: true,
            integer: true,
          })!;
          const text = readStringParam(params, "text", { required: true });
          try {
            await client.sendInput(sessionId, text);
            return jsonResult({
              success: true,
              message: `Sent input to session ${sessionId}.`,
            });
          } catch (err) {
            return jsonResult({ error: `Failed to send input: ${String(err)}` });
          }
        }

        case "list": {
          try {
            const sessions = await client.listSessions();
            return jsonResult({
              count: sessions.length,
              sessions: sessions.map((s) => ({
                id: s.id,
                status: s.status,
                mode: s.mode,
                branch: s.branch,
                project_path: s.project_path,
              })),
            });
          } catch (err) {
            return jsonResult({ error: `Failed to list sessions: ${String(err)}` });
          }
        }

        case "output": {
          const sessionId = readNumberParam(params, "sessionId", {
            required: true,
            integer: true,
          })!;
          const cursor = readNumberParam(params, "cursor", { integer: true });
          try {
            const result = await client.getOutput(sessionId, cursor ?? undefined);
            return jsonResult({
              output: result.output,
              cursor: result.cursor,
            });
          } catch (err) {
            return jsonResult({ error: `Failed to get output: ${String(err)}` });
          }
        }

        case "kill": {
          const sessionId = readNumberParam(params, "sessionId", {
            required: true,
            integer: true,
          })!;
          try {
            await client.killSession(sessionId);
            return jsonResult({
              success: true,
              message: `Session ${sessionId} terminated.`,
            });
          } catch (err) {
            return jsonResult({ error: `Failed to kill session: ${String(err)}` });
          }
        }

        default:
          return jsonResult({ error: `Unknown action: ${action}` });
      }
    },
  };
}
