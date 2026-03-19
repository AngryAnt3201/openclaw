// ---------------------------------------------------------------------------
// Gateway Analytics Service Builder – follows server-triage.ts/server-people.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { AnalyticsService } from "../analytics/service.js";
import { resolveAnalyticsStorePath } from "../analytics/store.js";
import { getChildLogger } from "../logging.js";

export type GatewayAnalyticsState = {
  analyticsService: AnalyticsService;
  storePath: string;
};

export function buildGatewayAnalyticsService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayAnalyticsState {
  const analyticsLogger = getChildLogger({ module: "analytics" });
  const storePath = resolveAnalyticsStorePath();

  const analyticsService = new AnalyticsService({
    storePath,
    log: {
      info: (msg) => analyticsLogger.info(msg),
      warn: (msg) => analyticsLogger.warn(msg),
      error: (msg) => analyticsLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { analyticsService, storePath };
}
