// ---------------------------------------------------------------------------
// Gateway KB Service Builder – follows server-vault.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { DEFAULT_KB_CONFIG } from "../knowledge-base/config.js";
import { KBService } from "../knowledge-base/service.js";
import { getChildLogger } from "../logging.js";

export type GatewayKBState = {
  kbService: KBService;
  close: () => Promise<void>;
};

export async function buildGatewayKBService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): Promise<GatewayKBState> {
  const kbLogger = getChildLogger({ module: "knowledge-base" });
  const kbConfig = params.cfg.knowledgeBase ?? DEFAULT_KB_CONFIG;
  const kbService = new KBService({
    config: kbConfig,
    log: {
      info: (msg) => kbLogger.info(msg),
      warn: (msg) => kbLogger.warn(msg),
      error: (msg) => kbLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });
  if (kbConfig.enabled) {
    await kbService.init();
  }
  return { kbService, close: () => kbService.close() };
}
