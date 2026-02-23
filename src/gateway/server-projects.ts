// ---------------------------------------------------------------------------
// Gateway Project Service Builder – follows server-widgets.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { ProjectService } from "../projects/service.js";
import { resolveProjectStorePath } from "../projects/store.js";

export type GatewayProjectState = {
  projectService: ProjectService;
  storePath: string;
};

export function buildGatewayProjectService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayProjectState {
  const projectLogger = getChildLogger({ module: "projects" });
  const storePath = resolveProjectStorePath((params.cfg as any).projects?.store);

  const projectService = new ProjectService({
    storePath,
    log: {
      info: (msg) => projectLogger.info(msg),
      warn: (msg) => projectLogger.warn(msg),
      error: (msg) => projectLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { projectService, storePath };
}
