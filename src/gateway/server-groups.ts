// ---------------------------------------------------------------------------
// Gateway Group Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { GroupService } from "../groups/service.js";
import { resolveGroupStorePath } from "../groups/store.js";
import { getChildLogger } from "../logging.js";

export type GatewayGroupState = {
  groupService: GroupService;
  storePath: string;
};

export function buildGatewayGroupService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayGroupState {
  const groupLogger = getChildLogger({ module: "groups" });
  const storePath = resolveGroupStorePath(
    (params.cfg as unknown as Record<string, Record<string, unknown>>).groups?.store as
      | string
      | undefined,
  );

  const groupService = new GroupService({
    storePath,
    log: {
      info: (msg) => groupLogger.info(msg),
      warn: (msg) => groupLogger.warn(msg),
      error: (msg) => groupLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { groupService, storePath };
}
