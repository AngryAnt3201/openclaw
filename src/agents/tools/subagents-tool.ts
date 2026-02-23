// ---------------------------------------------------------------------------
// subagents-tool – list and inspect active sub-agent runs
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import {
  listSubagentRunsForRequester,
} from "../subagent-registry.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SubagentsToolSchema = Type.Object({
  action: Type.Optional(Type.String()),
});

export function createSubagentsTool(opts?: {
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Subagents",
    name: "subagents",
    description:
      "List active sub-agent runs spawned by the current session. Use action='list' (default) to see all active sub-agents.",
    parameters: SubagentsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action") ?? "list";

      if (action === "list") {
        const sessionKey = opts?.agentSessionKey;
        if (!sessionKey) {
          return jsonResult({ runs: [], message: "No session key available" });
        }

        const runs = listSubagentRunsForRequester(sessionKey);
        return jsonResult({
          runs: runs.map((r) => ({
            runId: r.runId,
            label: r.label,
            task: r.task,
            agentId: parseAgentSessionKey(r.childSessionKey)?.agentId,
            sessionKey: r.childSessionKey,
            createdAt: r.createdAt,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            outcome: r.outcome,
          })),
          count: runs.length,
        });
      }

      return jsonResult({ error: `Unknown action: ${action}` });
    },
  };
}
