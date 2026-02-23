// ---------------------------------------------------------------------------
// Gateway Credential Service Builder – follows server-tasks.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import { LEASE_EXPIRY_INTERVAL_MS } from "../credentials/constants.js";
import { resolveMasterKey } from "../credentials/encryption.js";
import { CredentialService } from "../credentials/service.js";
import { resolveCredentialStorePath } from "../credentials/store.js";
import { ensureSystemAgentProfile } from "../credentials/system-agent.js";
import { getChildLogger } from "../logging.js";

export type GatewayCredentialState = {
  credentialService: CredentialService;
  storePath: string;
};

export async function buildGatewayCredentialService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): Promise<GatewayCredentialState> {
  const log = getChildLogger({ module: "credentials" });
  const storePath = resolveCredentialStorePath(params.cfg.credentials?.store);

  const masterKey = await resolveMasterKey();

  const credentialService = new CredentialService({
    storePath,
    masterKey,
    log: {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
    },
    broadcast: (event, payload) => {
      params.broadcast(event, payload, { dropIfSlow: true });
    },
  });

  // Initialize store (validates master key, creates store if needed)
  try {
    await credentialService.init();
  } catch (err) {
    log.error(
      `credential service init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Ensure system agent profile exists for channel token checkout
  try {
    await ensureSystemAgentProfile(credentialService);
  } catch (err) {
    log.warn(
      `system agent profile setup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Start periodic lease expiry
  credentialService.startLeaseExpiryTimer(LEASE_EXPIRY_INTERVAL_MS);

  return { credentialService, storePath };
}
