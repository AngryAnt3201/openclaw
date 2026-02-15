// ---------------------------------------------------------------------------
// Gateway Device Service Builder – follows server-launcher.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { DeviceService } from "../devices/service.js";
import { resolveDeviceStorePath } from "../devices/store.js";
import { getChildLogger } from "../logging.js";

export type GatewayDeviceState = {
  deviceService: DeviceService;
  storePath: string;
};

export function buildGatewayDeviceService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayDeviceState {
  const deviceLogger = getChildLogger({ module: "device-registry" });
  const storePath = resolveDeviceStorePath();

  const deviceService = new DeviceService({
    storePath,
    log: {
      info: (msg) => deviceLogger.info(msg),
      warn: (msg) => deviceLogger.warn(msg),
      error: (msg) => deviceLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  // Auto-create local device in the background
  deviceService.ensureLocalDevice().catch((err) => {
    deviceLogger.warn(`failed to auto-create local device: ${err}`);
  });

  return { deviceService, storePath };
}
