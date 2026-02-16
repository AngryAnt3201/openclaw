// ---------------------------------------------------------------------------
// Gateway Workflow Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { WorkflowEngine, type WorkflowEngineDeps } from "../workflow/engine.js";
import { WorkflowService } from "../workflow/service.js";
import { resolveWorkflowStorePath } from "../workflow/store.js";
import { callGateway } from "./call.js";

export type GatewayWorkflowState = {
  workflowService: WorkflowService;
  workflowEngine: WorkflowEngine;
  storePath: string;
};

export function buildGatewayWorkflowService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayWorkflowState {
  const wfLogger = getChildLogger({ module: "workflow" });
  const storePath = resolveWorkflowStorePath(params.cfg.workflow?.store);

  const workflowService = new WorkflowService({
    storePath,
    log: {
      info: (msg) => wfLogger.info(msg),
      warn: (msg) => wfLogger.warn(msg),
      error: (msg) => wfLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  const engineDeps: WorkflowEngineDeps = {
    workflowService,
    log: {
      info: (msg) => wfLogger.info(msg),
      warn: (msg) => wfLogger.warn(msg),
      error: (msg) => wfLogger.error(msg),
    },
    spawnSession: async (sessionParams) => {
      const result = await callGateway<{ runId: string }>({
        method: "agent",
        params: {
          message: sessionParams.message,
          sessionKey: sessionParams.sessionKey,
          idempotencyKey: randomUUID(),
          deliver: false,
          label: sessionParams.label,
          extraSystemPrompt: sessionParams.extraSystemPrompt,
        },
        timeoutMs: 60_000,
        clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
        clientDisplayName: "workflow-engine",
        mode: GATEWAY_CLIENT_MODES.BACKEND,
      });
      return { runId: ((result as Record<string, unknown>)?.runId as string) ?? randomUUID() };
    },
    checkSessionStatus: async (_runId) => {
      // Session status is tracked via agent events; for now return a simple check.
      // The engine will poll this periodically. In practice, agent completion events
      // update step status directly.
      return { done: false };
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  };

  const workflowEngine = new WorkflowEngine(engineDeps);

  return { workflowService, workflowEngine, storePath };
}
