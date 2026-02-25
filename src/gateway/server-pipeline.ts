// ---------------------------------------------------------------------------
// Gateway Pipeline Service Builder – follows server-cron.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { NodeRegistry } from "../pipeline/node-registry.js";
import { PipelineService } from "../pipeline/service.js";
import { resolvePipelineStorePath } from "../pipeline/store.js";

export type GatewayPipelineState = {
  pipelineService: PipelineService;
  pipelineNodeRegistry: NodeRegistry;
  storePath: string;
};

export function buildGatewayPipelineService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayPipelineState {
  const pipelineLogger = getChildLogger({ module: "pipeline" });
  const storePath = resolvePipelineStorePath(
    (params.cfg as Record<string, unknown>).pipeline
      ? (((params.cfg as Record<string, unknown>).pipeline as Record<string, unknown>)?.store as
          | string
          | undefined)
      : undefined,
  );

  const pipelineService = new PipelineService({
    storePath,
    onEvent: (evt) => {
      params.broadcast("pipeline", evt, { dropIfSlow: true });
      pipelineLogger.info(`pipeline event: ${evt.type} — ${evt.message}`);
    },
  });

  const pipelineNodeRegistry = new NodeRegistry();
  pipelineNodeRegistry.registerBuiltins();

  return { pipelineService, pipelineNodeRegistry, storePath };
}
