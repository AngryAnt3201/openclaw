// ---------------------------------------------------------------------------
// Gateway Task Service Builder – follows server-cron.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { TaskService } from "../tasks/service.js";
import { resolveTaskStorePath } from "../tasks/store.js";

export type GatewayTaskState = {
  taskService: TaskService;
  storePath: string;
};

export function buildGatewayTaskService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayTaskState {
  const taskLogger = getChildLogger({ module: "tasks" });
  const storePath = resolveTaskStorePath(params.cfg.tasks?.store);

  const taskService = new TaskService({
    storePath,
    log: {
      info: (msg) => taskLogger.info(msg),
      warn: (msg) => taskLogger.warn(msg),
      error: (msg) => taskLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { taskService, storePath };
}
