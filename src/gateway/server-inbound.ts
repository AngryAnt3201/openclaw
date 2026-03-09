// ---------------------------------------------------------------------------
// Gateway Inbound Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
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
}): GatewayInboundState {
  const inboundLogger = getChildLogger({ module: "inbound" });
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
  });

  // Startup prune — discard stale messages immediately
  inboundService.prune().catch((err) => {
    inboundLogger.warn(`inbound startup prune failed: ${err}`);
  });

  // TODO: schedule recurring prune every 6 hours (wire in server.impl.ts via setInterval)

  return { inboundService, storePath };
}
