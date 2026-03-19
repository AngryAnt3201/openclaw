// ---------------------------------------------------------------------------
// Gateway People Service Builder – follows server-widgets.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { PeopleService } from "../people/service.js";
import { resolvePeopleStorePath } from "../people/store.js";

export type GatewayPeopleState = {
  peopleService: PeopleService;
  storePath: string;
};

export function buildGatewayPeopleService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayPeopleState {
  const peopleLogger = getChildLogger({ module: "people" });
  const storePath = resolvePeopleStorePath();

  const peopleService = new PeopleService({
    storePath,
    log: {
      info: (msg) => peopleLogger.info(msg),
      warn: (msg) => peopleLogger.warn(msg),
      error: (msg) => peopleLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { peopleService, storePath };
}
