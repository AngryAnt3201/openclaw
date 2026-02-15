// ---------------------------------------------------------------------------
// Vault File Watcher – monitors vault directory for changes
// ---------------------------------------------------------------------------

import chokidar from "chokidar";
import * as path from "node:path";

export type VaultFileEvent = {
  type: "add" | "change" | "unlink";
  relativePath: string;
};

export type VaultWatcherCallbacks = {
  onFileChanged: (event: VaultFileEvent) => void;
};

export type VaultWatcher = {
  close: () => Promise<void>;
};

const DEBOUNCE_MS = 300;

export function createVaultWatcher(
  vaultPath: string,
  callbacks: VaultWatcherCallbacks,
): VaultWatcher {
  const pending = new Map<
    string,
    { type: VaultFileEvent["type"]; timer: ReturnType<typeof setTimeout> }
  >();

  const watcher = chokidar.watch(
    [path.join(vaultPath, "**/*.md"), path.join(vaultPath, "**/*.canvas")],
    {
      ignored: [
        /(^|[/\\])\./, // hidden files/dirs
        "**/node_modules/**",
        "**/.obsidian/**",
        "**/.trash/**",
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    },
  );

  function handleEvent(type: VaultFileEvent["type"], fullPath: string) {
    const relativePath = path.relative(vaultPath, fullPath);

    // Skip .tmp files (our atomic writes)
    if (relativePath.endsWith(".tmp")) {
      return;
    }

    const existing = pending.get(relativePath);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      pending.delete(relativePath);
      callbacks.onFileChanged({ type, relativePath });
    }, DEBOUNCE_MS);

    pending.set(relativePath, { type, timer });
  }

  watcher.on("add", (p) => handleEvent("add", p));
  watcher.on("change", (p) => handleEvent("change", p));
  watcher.on("unlink", (p) => handleEvent("unlink", p));

  return {
    close: async () => {
      // Clear all pending timers
      for (const { timer } of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
      await watcher.close();
    },
  };
}
