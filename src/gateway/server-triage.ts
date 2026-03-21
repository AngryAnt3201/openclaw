// ---------------------------------------------------------------------------
// Gateway Triage Service Builder – follows server-people.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { TriageService } from "../triage/service.js";
import { resolveTriageStorePath } from "../triage/store.js";

export type GatewayTriageState = {
  triageService: TriageService;
  storePath: string;
};

export function buildGatewayTriageService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayTriageState {
  const triageLogger = getChildLogger({ module: "triage" });
  const storePath = resolveTriageStorePath();

  const triageService = new TriageService({
    storePath,
    log: {
      info: (msg) => triageLogger.info(msg),
      warn: (msg) => triageLogger.warn(msg),
      error: (msg) => triageLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
    // runAITriage: undefined — will be wired later
  });

  return { triageService, storePath };
}
