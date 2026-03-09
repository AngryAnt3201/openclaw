// ---------------------------------------------------------------------------
// Gateway Inbound Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import type { InboundMessage, InboundRoute, InboundProcessingResult } from "../inbound/types.js";
import type { TaskService } from "../tasks/service.js";
import { setInboundBridge } from "../inbound/bridge.js";
import { InboundService } from "../inbound/service.js";
import { resolveInboundStorePath } from "../inbound/store.js";
import { getChildLogger } from "../logging.js";

export type GatewayInboundState = {
  inboundService: InboundService;
  storePath: string;
};

export function buildGatewayInboundService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  /** Lazy getter — task service may not exist yet at build time. */
  getTaskService?: () => TaskService | null;
}): GatewayInboundState {
  const inboundLogger = getChildLogger({ module: "inbound" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storePath = resolveInboundStorePath((params.cfg as any).inbound?.store);

  const inboundService = new InboundService({
    storePath,
    log: {
      info: (msg) => inboundLogger.info(msg),
      warn: (msg) => inboundLogger.warn(msg),
      error: (msg) => inboundLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
    executeAction: async (
      message: InboundMessage,
      route: InboundRoute,
    ): Promise<InboundProcessingResult | null> => {
      const action = route.action;

      // Ignore action — mark as ignored
      if (action.ignore) {
        return { summary: "Ignored by route: " + route.name };
      }

      // Create task action
      if (action.createTask) {
        const taskService = params.getTaskService?.();
        if (!taskService) {
          inboundLogger.warn("inbound action: createTask requested but task service unavailable");
          return { error: "Task service not available" };
        }
        try {
          const task = await taskService.create({
            title: message.subject ?? `Inbound: ${message.body.slice(0, 80)}`,
            description: message.body,
            priority: action.createTask.priority ?? message.priority,
            type: action.createTask.type ?? "instruction",
            source: "inbound",
            agentId: action.createTask.agentId,
            metadata: {
              inboundMessageId: message.id,
              sourceType: message.source.type,
              senderName: message.source.senderName,
            },
          });
          inboundLogger.info(`inbound action: created task ${task.id} from message ${message.id}`);
          return { taskId: task.id, summary: `Task created: ${task.title}` };
        } catch (err) {
          inboundLogger.error(`inbound action: createTask failed: ${String(err)}`);
          return { error: `Failed to create task: ${String(err)}` };
        }
      }

      // Forward to agent — enqueue system event
      if (action.forwardToAgent) {
        try {
          const { enqueueSystemEvent } = await import("../infra/system-events.js");
          const { requestHeartbeatNow } = await import("../infra/heartbeat-wake.js");
          const agentId = action.forwardToAgent;
          const eventText = `[Inbound from ${message.source.senderName ?? message.source.type}] ${message.body}`;
          enqueueSystemEvent(eventText, { sessionKey: agentId });
          requestHeartbeatNow({ reason: `inbound:${message.id}` });
          inboundLogger.info(`inbound action: forwarded message ${message.id} to agent ${agentId}`);
          return { agentId, summary: `Forwarded to agent: ${agentId}` };
        } catch (err) {
          inboundLogger.error(`inbound action: forwardToAgent failed: ${String(err)}`);
          return { error: `Failed to forward: ${String(err)}` };
        }
      }

      // Auto-reply — log it (actual reply would need outbound channel access)
      if (action.autoReply) {
        inboundLogger.info(
          `inbound action: auto-reply queued for message ${message.id}: "${action.autoReply.slice(0, 50)}"`,
        );
        return { summary: `Auto-reply: ${action.autoReply.slice(0, 100)}` };
      }

      // Run pipeline — log it (pipeline execution needs pipelineService)
      if (action.runPipeline) {
        inboundLogger.info(
          `inbound action: pipeline ${action.runPipeline} triggered by message ${message.id}`,
        );
        return { summary: `Pipeline triggered: ${action.runPipeline}` };
      }

      return null;
    },
  });

  // Startup prune — discard stale messages immediately
  inboundService.prune().catch((err) => {
    inboundLogger.warn(`inbound startup prune failed: ${err}`);
  });

  // Activate the global bridge so platform monitors forward messages
  setInboundBridge(inboundService, {
    info: (msg) => inboundLogger.info(msg),
    warn: (msg) => inboundLogger.warn(msg),
    error: (msg) => inboundLogger.error(msg),
  });

  return { inboundService, storePath };
}
