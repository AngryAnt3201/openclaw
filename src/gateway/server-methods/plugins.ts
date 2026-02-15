// ---------------------------------------------------------------------------
// Gateway RPC handlers for plugins.* methods
// ---------------------------------------------------------------------------

import type { GatewayRequestHandlers } from "./types.js";
import { clearPluginRegistryCache } from "../../plugins/loader.js";
import { clearPluginManifestCache } from "../../plugins/manifest-registry.js";
import { getActivePluginRegistry } from "../../plugins/runtime.js";

export const pluginsHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // plugins.reload — clear all plugin caches so next turn re-discovers
  // -------------------------------------------------------------------------
  "plugins.reload": async ({ respond }) => {
    clearPluginRegistryCache();
    clearPluginManifestCache();
    respond(
      true,
      {
        reloaded: true,
        message: "Plugin caches cleared. New plugins will be loaded on next agent turn.",
      },
      undefined,
    );
  },

  // -------------------------------------------------------------------------
  // plugins.list — return loaded plugins with diagnostics
  // -------------------------------------------------------------------------
  "plugins.list": async ({ respond }) => {
    const registry = getActivePluginRegistry();
    if (!registry) {
      respond(true, { plugins: [], diagnostics: [] }, undefined);
      return;
    }

    const plugins = registry.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      status: p.status,
      enabled: p.enabled,
      origin: p.origin,
      toolNames: p.toolNames,
      hookNames: p.hookNames,
      error: p.error,
    }));

    const diagnostics = registry.diagnostics.map((d) => ({
      level: d.level,
      pluginId: d.pluginId,
      message: d.message,
      source: d.source,
    }));

    respond(true, { plugins, diagnostics }, undefined);
  },
};
