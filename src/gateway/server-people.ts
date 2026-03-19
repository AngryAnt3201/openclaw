// ---------------------------------------------------------------------------
// Gateway People Service Builder – follows server-widgets.ts pattern
// ---------------------------------------------------------------------------

import type { CliDeps } from "../cli/deps.js";
import type { loadConfig } from "../config/config.js";
import type { Organization, Person } from "../people/types.js";
import type { VaultService } from "../vault/service.js";
import { getChildLogger } from "../logging.js";
import { PeopleService } from "../people/service.js";
import { resolvePeopleStorePath } from "../people/store.js";
import { syncOrgToVault, syncPersonToVault } from "../vault/sync/people-sync.js";

export type GatewayPeopleState = {
  peopleService: PeopleService;
  storePath: string;
};

export function buildGatewayPeopleService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  getVaultService?: () => VaultService | undefined;
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

      // Vault sync triggers
      const vaultService = params.getVaultService?.();
      if (!vaultService) {
        return;
      }

      if (event === "people.person.created" || event === "people.person.updated") {
        const person = payload as Person;
        if (person?.id) {
          void syncPersonToVault(person, vaultService).catch(() => {});
        }
      }

      if (event === "people.org.created" || event === "people.org.updated") {
        const org = payload as Organization;
        if (org?.id) {
          void syncOrgToVault(org, vaultService).catch(() => {});
        }
      }
    },
  });

  return { peopleService, storePath };
}
