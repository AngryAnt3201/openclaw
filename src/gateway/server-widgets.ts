// ---------------------------------------------------------------------------
// Gateway Widget Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { WidgetService } from "../widgets/service.js";
import { resolveWidgetStorePath } from "../widgets/store.js";

export type GatewayWidgetState = {
  widgetService: WidgetService;
  storePath: string;
};

export function buildGatewayWidgetService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayWidgetState {
  const widgetLogger = getChildLogger({ module: "widgets" });
  const storePath = resolveWidgetStorePath((params.cfg as any).widgets?.store);

  const widgetService = new WidgetService({
    storePath,
    log: {
      info: (msg) => widgetLogger.info(msg),
      warn: (msg) => widgetLogger.warn(msg),
      error: (msg) => widgetLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { widgetService, storePath };
}
