// ---------------------------------------------------------------------------
// Knowledge Base – Provider Adapters
// ---------------------------------------------------------------------------

import type { KBConfig, KBProviderType } from "./types.js";

export type KBProvider = {
  id: KBProviderType;
  label: string;
  openVault: () => string;
  openNote: (path: string) => string;
  search: (query: string) => string;
};

export function obsidianProvider(config: KBConfig): KBProvider {
  const vault = config.vaultName || "";
  return {
    id: "obsidian",
    label: "Obsidian",
    openVault: () => `obsidian://open?vault=${vault}`,
    openNote: (path) => `obsidian://open?vault=${vault}&file=${encodeURIComponent(path)}`,
    search: (query) => `obsidian://search?vault=${vault}&query=${encodeURIComponent(query)}`,
  };
}

export function logseqProvider(config: KBConfig): KBProvider {
  const graph = config.vaultName || "";
  return {
    id: "logseq",
    label: "Logseq",
    openVault: () => `logseq://graph/${graph}`,
    openNote: (path) => `logseq://graph/${graph}?page=${path}`,
    search: (query) => `logseq://graph/${graph}?search=${encodeURIComponent(query)}`,
  };
}

export function notionProvider(config: KBConfig): KBProvider {
  const workspace = config.vaultName || "";
  return {
    id: "notion",
    label: "Notion",
    openVault: () => `notion://www.notion.so/${workspace}`,
    openNote: (path) => `notion://www.notion.so/${workspace}/${path}`,
    search: (query) => `notion://www.notion.so/${workspace}?search=${encodeURIComponent(query)}`,
  };
}

export function customProvider(config: KBConfig): KBProvider {
  const vault = config.vaultPath || "";
  const openCmd = config.openCommand || `open {vault}`;
  const searchCmd = config.searchCommand || openCmd;

  function interpolate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{${key}}`, value);
    }
    return result;
  }

  return {
    id: "custom",
    label: "Custom",
    openVault: () => interpolate(openCmd, { vault }),
    openNote: (path) => interpolate(openCmd, { vault, path }),
    search: (query) => interpolate(searchCmd, { vault, query }),
  };
}

export function createProvider(config: KBConfig): KBProvider {
  switch (config.provider) {
    case "obsidian":
      return obsidianProvider(config);
    case "logseq":
      return logseqProvider(config);
    case "notion":
      return notionProvider(config);
    case "custom":
      return customProvider(config);
    default:
      return obsidianProvider(config);
  }
}
