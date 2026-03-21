// ---------------------------------------------------------------------------
// Gateway Vault Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { VaultService } from "../vault/service.js";
import { resolveVaultPath } from "../vault/store.js";

export type GatewayVaultState = {
  vaultService: VaultService;
  vaultPath: string;
  close: () => Promise<void>;
};

export async function buildGatewayVaultService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): Promise<GatewayVaultState> {
  const vaultLogger = getChildLogger({ module: "vault" });
  // Prefer explicit vault.vaultPath, fall back to knowledgeBase.vaultPath so both
  // the vault tool and KB service share a single source of truth (e.g. Obsidian vault).
  const vaultPath = resolveVaultPath(
    params.cfg.vault?.vaultPath ?? params.cfg.knowledgeBase?.vaultPath,
  );

  const vaultService = new VaultService({
    vaultPath,
    config: params.cfg.vault ?? {},
    log: {
      info: (msg) => vaultLogger.info(msg),
      warn: (msg) => vaultLogger.warn(msg),
      error: (msg) => vaultLogger.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  await vaultService.init();

  return {
    vaultService,
    vaultPath,
    close: () => vaultService.close(),
  };
}
