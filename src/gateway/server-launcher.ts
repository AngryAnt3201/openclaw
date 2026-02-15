// ---------------------------------------------------------------------------
// Gateway Launcher Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { LauncherService } from "../launcher/service.js";
import { migrateLegacyLauncherStore, resolveLauncherStorePath } from "../launcher/store.js";
import { getChildLogger } from "../logging.js";

export type GatewayLauncherState = {
  launcherService: LauncherService;
  storePath: string;
};

export function buildGatewayLauncherService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayLauncherState {
  const launcherLogger = getChildLogger({ module: "launcher" });
  const storePath = resolveLauncherStorePath(params.cfg.launcher?.store);

  // Kick off legacy migration in the background (fire-and-forget)
  migrateLegacyLauncherStore(storePath).then(
    (migrated) => {
      if (migrated) {
        launcherLogger.info("migrated legacy ~/.maestro-launcher.json → openclaw store");
      }
    },
    (err) => {
      launcherLogger.warn(`legacy launcher migration failed: ${err}`);
    },
  );

  const launcherService = new LauncherService({
    storePath,
    log: {
      info: (msg) => launcherLogger.info(msg),
      warn: (msg) => launcherLogger.warn(msg),
      error: (msg) => launcherLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  return { launcherService, storePath };
}
