// ---------------------------------------------------------------------------
// Gateway Workspace Service Builder – follows server-widgets.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { WorkspaceRuntime } from "../workspaces/runtime.js";
import { WorkspaceService } from "../workspaces/service.js";
import { resolveWorkspaceStorePath } from "../workspaces/store.js";

export type GatewayWorkspaceState = {
  workspaceService: WorkspaceService;
  workspaceRuntime: WorkspaceRuntime;
  storePath: string;
};

export function buildGatewayWorkspaceService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayWorkspaceState {
  const wsLogger = getChildLogger({ module: "workspaces" });
  const storePath = resolveWorkspaceStorePath((params.cfg as any).workspaces?.store);

  const workspaceService = new WorkspaceService({
    storePath,
    log: {
      info: (msg) => wsLogger.info(msg),
      warn: (msg) => wsLogger.warn(msg),
      error: (msg) => wsLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  const workspaceRuntime = new WorkspaceRuntime({
    log: {
      info: (msg) => wsLogger.info(msg),
      warn: (msg) => wsLogger.warn(msg),
      error: (msg) => wsLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { workspaceService, workspaceRuntime, storePath };
}
