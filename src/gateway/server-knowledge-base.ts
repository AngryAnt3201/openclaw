// ---------------------------------------------------------------------------
// Gateway KB Service Builder – follows server-vault.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { KBService } from "../knowledge-base/service.js";
import { DEFAULT_KB_CONFIG } from "../knowledge-base/config.js";

export type GatewayKBState = {
  kbService: KBService;
  close: () => Promise<void>;
};

export async function buildGatewayKBService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): Promise<GatewayKBState> {
  const kbLogger = getChildLogger({ module: "kb" });
  const cfgKB = (params.cfg as Record<string, unknown>).knowledgeBase as
    | Record<string, unknown>
    | undefined;

  const kbConfig = cfgKB
    ? {
        enabled: cfgKB.enabled === true,
        provider: (cfgKB.provider as string) ?? DEFAULT_KB_CONFIG.provider,
        vaultPath: (cfgKB.vaultPath as string) ?? DEFAULT_KB_CONFIG.vaultPath,
        vaultName: cfgKB.vaultName as string | undefined,
        syncFolder: (cfgKB.syncFolder as string) ?? DEFAULT_KB_CONFIG.syncFolder,
        openCommand: cfgKB.openCommand as string | undefined,
        searchCommand: cfgKB.searchCommand as string | undefined,
      }
    : DEFAULT_KB_CONFIG;

  const kbService = new KBService({
    config: kbConfig as any,
    log: {
      info: (msg) => kbLogger.info(msg),
      warn: (msg) => kbLogger.warn(msg),
      error: (msg) => kbLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  await kbService.init();

  return {
    kbService,
    close: () => kbService.close(),
  };
}
