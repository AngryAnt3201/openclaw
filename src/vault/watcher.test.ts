import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultFileEvent } from "./watcher.js";

// ---------------------------------------------------------------------------
// Mock chokidar – deterministic, no filesystem timing issues
// ---------------------------------------------------------------------------

type EventHandler = (fullPath: string) => void;

const handlers = new Map<string, EventHandler[]>();

const mockWatcher = {
  on(event: string, handler: EventHandler) {
    const existing = handlers.get(event) ?? [];
    existing.push(handler);
    handlers.set(event, existing);
    return mockWatcher;
  },
  close: vi.fn(async () => {}),
};

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => mockWatcher),
  },
}));

// Import AFTER mock is set up
const { createVaultWatcher } = await import("./watcher.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitChokidarEvent(type: "add" | "change" | "unlink", fullPath: string) {
  const fns = handlers.get(type) ?? [];
  for (const fn of fns) {
    fn(fullPath);
  }
}

function waitForEvent(events: VaultFileEvent[], timeout = 2000): Promise<VaultFileEvent> {
  return new Promise((resolve, reject) => {
    const start = events.length;
    const check = setInterval(() => {
      if (events.length > start) {
        clearInterval(check);
        resolve(events[events.length - 1]!);
      }
    }, 50);
    setTimeout(() => {
      clearInterval(check);
      reject(new Error(`timeout waiting for event (got ${events.length - start})`));
    }, timeout);
  });
}

const VAULT_PATH = "/tmp/test-vault";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createVaultWatcher", () => {
  beforeEach(() => {
    handlers.clear();
    vi.useFakeTimers();
    mockWatcher.close.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Creates watcher without error
  // -----------------------------------------------------------------------

  it("creates a watcher without throwing", () => {
    const events: VaultFileEvent[] = [];
    const watcher = createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });
    expect(watcher).toBeDefined();
    expect(typeof watcher.close).toBe("function");
  });

  // -----------------------------------------------------------------------
  // 2. close() resolves cleanly
  // -----------------------------------------------------------------------

  it("close resolves cleanly", async () => {
    const watcher = createVaultWatcher(VAULT_PATH, {
      onFileChanged: () => {},
    });
    await expect(watcher.close()).resolves.toBeUndefined();
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Can close multiple times
  // -----------------------------------------------------------------------

  it("can close multiple times without error", async () => {
    const watcher = createVaultWatcher(VAULT_PATH, {
      onFileChanged: () => {},
    });
    await watcher.close();
    await expect(watcher.close()).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 4. Ignores .tmp files
  // -----------------------------------------------------------------------

  it("ignores .tmp files", () => {
    const events: VaultFileEvent[] = [];
    createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });

    emitChokidarEvent("add", path.join(VAULT_PATH, "note.md.tmp"));

    // Advance past debounce
    vi.advanceTimersByTime(500);

    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 5. Add file triggers "add" event
  // -----------------------------------------------------------------------

  it("detects file add", () => {
    const events: VaultFileEvent[] = [];
    createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });

    emitChokidarEvent("add", path.join(VAULT_PATH, "new-note.md"));

    // Advance past DEBOUNCE_MS (300ms)
    vi.advanceTimersByTime(400);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("add");
    expect(events[0]!.relativePath).toBe("new-note.md");
  });

  // -----------------------------------------------------------------------
  // 6. Change file triggers "change" event
  // -----------------------------------------------------------------------

  it("detects file change", () => {
    const events: VaultFileEvent[] = [];
    createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });

    emitChokidarEvent("change", path.join(VAULT_PATH, "existing.md"));

    vi.advanceTimersByTime(400);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("change");
    expect(events[0]!.relativePath).toBe("existing.md");
  });

  // -----------------------------------------------------------------------
  // 7. Unlink triggers "unlink" event
  // -----------------------------------------------------------------------

  it("detects file unlink", () => {
    const events: VaultFileEvent[] = [];
    createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });

    emitChokidarEvent("unlink", path.join(VAULT_PATH, "deleted.md"));

    vi.advanceTimersByTime(400);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("unlink");
    expect(events[0]!.relativePath).toBe("deleted.md");
  });

  // -----------------------------------------------------------------------
  // 8. Debounces rapid changes into a single event
  // -----------------------------------------------------------------------

  it("debounces rapid changes into a single event", () => {
    const events: VaultFileEvent[] = [];
    createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });

    const filePath = path.join(VAULT_PATH, "rapid.md");

    // Emit rapid changes within the debounce window
    emitChokidarEvent("change", filePath);
    vi.advanceTimersByTime(100);
    emitChokidarEvent("change", filePath);
    vi.advanceTimersByTime(100);
    emitChokidarEvent("change", filePath);

    // At this point, only the latest timer should be active; no callbacks yet
    expect(events).toHaveLength(0);

    // Advance past the debounce (300ms from the last event)
    vi.advanceTimersByTime(400);

    // Should have only one debounced event
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("change");
    expect(events[0]!.relativePath).toBe("rapid.md");
  });

  // -----------------------------------------------------------------------
  // 9. Relative path is correct for subdirectory files
  // -----------------------------------------------------------------------

  it("reports correct relative path for nested files", () => {
    const events: VaultFileEvent[] = [];
    createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });

    emitChokidarEvent("add", path.join(VAULT_PATH, "notes", "sub", "deep.md"));

    vi.advanceTimersByTime(400);

    expect(events).toHaveLength(1);
    expect(events[0]!.relativePath).toBe(path.join("notes", "sub", "deep.md"));
  });

  // -----------------------------------------------------------------------
  // 10. Close clears pending timers
  // -----------------------------------------------------------------------

  it("close clears pending debounced events", async () => {
    const events: VaultFileEvent[] = [];
    const watcher = createVaultWatcher(VAULT_PATH, {
      onFileChanged: (e) => events.push(e),
    });

    // Emit an event but don't let debounce fire
    emitChokidarEvent("add", path.join(VAULT_PATH, "pending.md"));

    // Close immediately — pending timer should be cleared
    await watcher.close();

    // Advance timers — the callback should NOT fire since we closed
    vi.advanceTimersByTime(1000);

    expect(events).toHaveLength(0);
  });
});
