// ---------------------------------------------------------------------------
// Gateway Inbound Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import type { CredentialService } from "../credentials/service.js";
import type { CredentialSecret } from "../credentials/types.js";
import type { InboundMessage, InboundRoute, InboundProcessingResult } from "../inbound/types.js";
import type { TaskService } from "../tasks/service.js";
import { SYSTEM_AGENT_ID } from "../credentials/system-agent.js";
import { setInboundBridge } from "../inbound/bridge.js";
import { PollerManager } from "../inbound/pollers/manager.js";
import { InboundService } from "../inbound/service.js";
import { resolveInboundStorePath } from "../inbound/store.js";
import { getChildLogger } from "../logging.js";

// ---------------------------------------------------------------------------
// flattenSecret – convert typed CredentialSecret into flat key-value pairs
// ---------------------------------------------------------------------------

function flattenSecret(secret: CredentialSecret, out: Record<string, string>): void {
  switch (secret.kind) {
    case "api_key":
      out.key = secret.key;
      if (secret.email) {
        out.imapUser = secret.email;
      }
      if (secret.metadata) {
        for (const [k, v] of Object.entries(secret.metadata)) {
          out[k] = v;
        }
      }
      break;

    case "token":
      out.token = secret.token;
      if (secret.refreshToken) {
        out.refreshToken = secret.refreshToken;
      }
      if (secret.email) {
        out.email = secret.email;
      }
      break;

    case "oauth":
      out.accessToken = secret.accessToken;
      out.refreshToken = secret.refreshToken;
      if (secret.clientId) {
        out.clientId = secret.clientId;
      }
      if (secret.email) {
        out.email = secret.email;
      }
      if (secret.scopes) {
        out.scopes = secret.scopes.join(",");
      }
      break;

    case "ssh_key":
      out.privateKey = secret.privateKey;
      if (secret.publicKey) {
        out.publicKey = secret.publicKey;
      }
      if (secret.passphrase) {
        out.passphrase = secret.passphrase;
      }
      break;
  }
}

export type GatewayInboundState = {
  inboundService: InboundService;
  pollerManager: PollerManager;
  storePath: string;
};

export function buildGatewayInboundService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  /** Lazy getter — task service may not exist yet at build time. */
  getTaskService?: () => TaskService | null;
  /** Lazy getter — credential service may not exist yet at build time. */
  getCredentialService?: () => CredentialService | null;
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
            priority: (action.createTask.priority ?? message.priority ?? "medium") as
              | "high"
              | "medium"
              | "low",
            type: (action.createTask.type ?? "instruction") as "instruction",
            source: "api" as const,
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

  // ---------------------------------------------------------------------------
  // Poller Manager — manages per-channel polling lifecycles
  // ---------------------------------------------------------------------------

  const pollerManager = new PollerManager({
    inboundService,
    log: {
      info: (msg) => inboundLogger.info(msg),
      warn: (msg) => inboundLogger.warn(msg),
      error: (msg) => inboundLogger.error(msg),
    },
    broadcast: (event, payload) => params.broadcast(event, payload, { dropIfSlow: true }),
    resolveCredentials: async (credentialAccountId: string) => {
      const credSvc = params.getCredentialService?.();
      if (!credSvc) {
        inboundLogger.warn(
          `[resolveCredentials] credential service not available for account ${credentialAccountId}`,
        );
        return {};
      }

      // Look up the account to get its credential IDs
      const account = await credSvc.getAccount(credentialAccountId);
      if (!account) {
        inboundLogger.warn(`[resolveCredentials] account not found: ${credentialAccountId}`);
        return {};
      }

      if (account.credentialIds.length === 0) {
        inboundLogger.warn(
          `[resolveCredentials] account ${credentialAccountId} has no credentials`,
        );
        return {};
      }

      // Start with account metadata — may contain host/user info set during
      // channel creation (e.g. imapHost, imapUser).
      const result: Record<string, string> = { ...account.metadata };

      // Checkout each credential and flatten decrypted secrets into the map.
      // Uses SYSTEM_AGENT_ID which is auto-bound to channel accounts.
      for (const credentialId of account.credentialIds) {
        try {
          const checkout = await credSvc.checkout({
            credentialId,
            agentId: SYSTEM_AGENT_ID,
            action: "inbound-poller",
          });

          flattenSecret(checkout.secret, result);
        } catch (err) {
          inboundLogger.warn(
            `[resolveCredentials] checkout failed for credential ${credentialId}: ${String(err)}`,
          );
        }
      }

      return result;
    },
    onWhatsAppQr: (channelId, qr) => {
      params.broadcast("inbound.whatsapp.qr", { channelId, qr }, { dropIfSlow: true });
    },
  });

  // Fire-and-forget: start pollers for all existing enabled channels
  void inboundService.listChannels().then((channels) => {
    void pollerManager.startAll(channels);
  });

  return { inboundService, pollerManager, storePath };
}
