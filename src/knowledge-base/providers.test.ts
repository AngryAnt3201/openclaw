// ---------------------------------------------------------------------------
// Knowledge Base – Provider Adapters – Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { KBConfig } from "./types.js";
import {
  obsidianProvider,
  logseqProvider,
  notionProvider,
  customProvider,
  createProvider,
} from "./providers.js";

function makeConfig(overrides: Partial<KBConfig> = {}): KBConfig {
  return {
    enabled: true,
    provider: "obsidian",
    vaultPath: "/tmp/vault",
    vaultName: "TestVault",
    ...overrides,
  };
}

// ── Obsidian ────────────────────────────────────────────────────────────────

describe("obsidianProvider", () => {
  it("openVault returns obsidian:// URI with vault name", () => {
    const p = obsidianProvider(makeConfig());
    expect(p.openVault()).toBe("obsidian://open?vault=TestVault");
  });

  it("openNote URL-encodes the path", () => {
    const p = obsidianProvider(makeConfig());
    expect(p.openNote("folder/My Note.md")).toBe(
      "obsidian://open?vault=TestVault&file=folder%2FMy%20Note.md",
    );
  });

  it("search URL-encodes the query", () => {
    const p = obsidianProvider(makeConfig());
    expect(p.search("tag:#important & status")).toBe(
      "obsidian://search?vault=TestVault&query=tag%3A%23important%20%26%20status",
    );
  });

  it("id and label are correct", () => {
    const p = obsidianProvider(makeConfig());
    expect(p.id).toBe("obsidian");
    expect(p.label).toBe("Obsidian");
  });

  it("falls back to empty string when vaultName is undefined", () => {
    const p = obsidianProvider(makeConfig({ vaultName: undefined }));
    expect(p.openVault()).toBe("obsidian://open?vault=");
  });
});

// ── Logseq ──────────────────────────────────────────────────────────────────

describe("logseqProvider", () => {
  it("openVault returns logseq:// graph URI", () => {
    const p = logseqProvider(makeConfig({ provider: "logseq" }));
    expect(p.openVault()).toBe("logseq://graph/TestVault");
  });

  it("openNote appends page query param", () => {
    const p = logseqProvider(makeConfig({ provider: "logseq" }));
    expect(p.openNote("Daily Notes")).toBe("logseq://graph/TestVault?page=Daily Notes");
  });

  it("search URL-encodes the query", () => {
    const p = logseqProvider(makeConfig({ provider: "logseq" }));
    expect(p.search("TODO items")).toBe("logseq://graph/TestVault?search=TODO%20items");
  });

  it("id and label are correct", () => {
    const p = logseqProvider(makeConfig({ provider: "logseq" }));
    expect(p.id).toBe("logseq");
    expect(p.label).toBe("Logseq");
  });
});

// ── Notion ──────────────────────────────────────────────────────────────────

describe("notionProvider", () => {
  it("openVault returns notion:// workspace URI", () => {
    const p = notionProvider(makeConfig({ provider: "notion", vaultName: "my-workspace" }));
    expect(p.openVault()).toBe("notion://www.notion.so/my-workspace");
  });

  it("openNote appends page path", () => {
    const p = notionProvider(makeConfig({ provider: "notion", vaultName: "ws" }));
    expect(p.openNote("page-id-123")).toBe("notion://www.notion.so/ws/page-id-123");
  });

  it("search URL-encodes the query", () => {
    const p = notionProvider(makeConfig({ provider: "notion", vaultName: "ws" }));
    expect(p.search("meeting notes")).toBe("notion://www.notion.so/ws?search=meeting%20notes");
  });

  it("id and label are correct", () => {
    const p = notionProvider(makeConfig({ provider: "notion" }));
    expect(p.id).toBe("notion");
    expect(p.label).toBe("Notion");
  });
});

// ── Custom ──────────────────────────────────────────────────────────────────

describe("customProvider", () => {
  it("interpolates {vault} in openVault", () => {
    const p = customProvider(
      makeConfig({
        provider: "custom",
        vaultPath: "/home/user/notes",
        openCommand: "code {vault}",
      }),
    );
    expect(p.openVault()).toBe("code /home/user/notes");
  });

  it("interpolates {vault} and {path} in openNote", () => {
    const p = customProvider(
      makeConfig({
        provider: "custom",
        vaultPath: "/notes",
        openCommand: "vim {vault}/{path}",
      }),
    );
    expect(p.openNote("todo.md")).toBe("vim /notes/todo.md");
  });

  it("interpolates {vault} and {query} in search using searchCommand", () => {
    const p = customProvider(
      makeConfig({
        provider: "custom",
        vaultPath: "/notes",
        searchCommand: "rg {query} {vault}",
      }),
    );
    expect(p.search("TODO")).toBe("rg TODO /notes");
  });

  it("falls back to openCommand for search when searchCommand is absent", () => {
    const p = customProvider(
      makeConfig({
        provider: "custom",
        vaultPath: "/notes",
        openCommand: "open {vault}",
        searchCommand: undefined,
      }),
    );
    // search falls back to openCmd — {query} is not in template, so just {vault} replaced
    expect(p.search("anything")).toBe("open /notes");
  });

  it("uses default openCommand when none provided", () => {
    const p = customProvider(
      makeConfig({
        provider: "custom",
        vaultPath: "/my/vault",
        openCommand: undefined,
      }),
    );
    expect(p.openVault()).toBe("open /my/vault");
  });

  it("id and label are correct", () => {
    const p = customProvider(makeConfig({ provider: "custom" }));
    expect(p.id).toBe("custom");
    expect(p.label).toBe("Custom");
  });
});

// ── createProvider factory ──────────────────────────────────────────────────

describe("createProvider", () => {
  it("returns obsidian provider for provider=obsidian", () => {
    const p = createProvider(makeConfig({ provider: "obsidian" }));
    expect(p.id).toBe("obsidian");
    expect(p.label).toBe("Obsidian");
  });

  it("returns logseq provider for provider=logseq", () => {
    const p = createProvider(makeConfig({ provider: "logseq" }));
    expect(p.id).toBe("logseq");
    expect(p.label).toBe("Logseq");
  });

  it("returns notion provider for provider=notion", () => {
    const p = createProvider(makeConfig({ provider: "notion" }));
    expect(p.id).toBe("notion");
    expect(p.label).toBe("Notion");
  });

  it("returns custom provider for provider=custom", () => {
    const p = createProvider(makeConfig({ provider: "custom" }));
    expect(p.id).toBe("custom");
    expect(p.label).toBe("Custom");
  });

  it("defaults to obsidian for unknown provider type", () => {
    const p = createProvider(makeConfig({ provider: "unknown" as KBConfig["provider"] }));
    expect(p.id).toBe("obsidian");
  });

  it("factory-created providers produce correct URIs", () => {
    const p = createProvider(makeConfig({ provider: "logseq", vaultName: "Graph1" }));
    expect(p.openVault()).toBe("logseq://graph/Graph1");
    expect(p.openNote("page")).toBe("logseq://graph/Graph1?page=page");
  });
});
