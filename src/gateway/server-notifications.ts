// ---------------------------------------------------------------------------
// Gateway Notification Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import type { NodeRegistry } from "./node-registry.js";
import { getChildLogger } from "../logging.js";
import { NotificationService } from "../notifications/service.js";
import { resolveNotificationStorePath } from "../notifications/store.js";
import { createNotificationTriggers } from "../notifications/triggers.js";

export type GatewayNotificationState = {
  notificationService: NotificationService;
  storePath: string;
  triggers: ReturnType<typeof createNotificationTriggers>;
};

export function buildGatewayNotificationService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  nodeRegistry: NodeRegistry;
}): GatewayNotificationState {
  const notifLogger = getChildLogger({ module: "notifications" });
  const storePath = resolveNotificationStorePath(params.cfg.notifications?.store);

  const channelTargets: Record<string, string> = {};
  const targets = params.cfg.notifications?.channelTargets;
  if (targets) {
    for (const [k, v] of Object.entries(targets)) {
      if (typeof v === "string" && v.trim()) {
        channelTargets[k] = v.trim();
      }
    }
  }

  const notificationService = new NotificationService({
    storePath,
    log: {
      info: (msg) => notifLogger.info(msg),
      warn: (msg) => notifLogger.warn(msg),
      error: (msg) => notifLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
    dispatch: {
      cfg: params.cfg,
      channelTargets,
      log: {
        info: (msg) => notifLogger.info(msg),
        warn: (msg) => notifLogger.warn(msg),
        error: (msg) => notifLogger.error(msg),
      },
      nodeInvoker: {
        listConnectedNodes: () =>
          params.nodeRegistry.listConnected().map((n) => ({
            nodeId: n.nodeId,
            commands: n.commands,
            platform: n.platform,
          })),
        invoke: (p) => params.nodeRegistry.invoke(p),
      },
    },
  });

  const triggers = createNotificationTriggers({
    notificationService,
    log: {
      info: (msg) => notifLogger.info(msg),
      warn: (msg) => notifLogger.warn(msg),
      error: (msg) => notifLogger.error(msg),
    },
  });

  return { notificationService, storePath, triggers };
}
