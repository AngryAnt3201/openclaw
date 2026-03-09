import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundStoreFile } from "./types.js";
import { readInboundStore, resolveInboundStorePath, writeInboundStore } from "./store.js";

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-inbound-store-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveInboundStorePath", () => {
  it("returns default path under ~/.openclaw/inbound/ when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveInboundStorePath();
    expect(result).toBe(path.join("/home/testuser", ".openclaw", "inbound", "store.json"));
  });

  it("resolves custom path when provided", () => {
    const result = resolveInboundStorePath("/custom/path/inbound.json");
    expect(result).toBe(path.resolve("/custom/path/inbound.json"));
  });
});

// ---------------------------------------------------------------------------
// Store read
// ---------------------------------------------------------------------------

describe("readInboundStore", () => {
  it("returns empty store when file does not exist", async () => {
    const store = await readInboundStore(storePath);
    expect(store).toEqual({ version: 1, messages: [], channels: [], routes: [] });
  });

  it("reads valid store file", async () => {
    const data: InboundStoreFile = {
      version: 1,
      messages: [
        {
          id: "msg-1",
          source: { type: "discord", channelId: "ch1" },
          status: "pending",
          priority: "medium",
          body: "Hello world",
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
      channels: [
        {
          id: "ch1",
          type: "discord",
          name: "general",
          enabled: true,
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
      routes: [],
    };
    await fs.writeFile(storePath, JSON.stringify(data), "utf-8");
    const store = await readInboundStore(storePath);
    expect(store.version).toBe(1);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.id).toBe("msg-1");
    expect(store.channels).toHaveLength(1);
    expect(store.channels[0]!.name).toBe("general");
    expect(store.routes).toHaveLength(0);
  });

  it("returns empty store for corrupt JSON", async () => {
    await fs.writeFile(storePath, "{ broken json", "utf-8");
    const store = await readInboundStore(storePath);
    expect(store).toEqual({ version: 1, messages: [], channels: [], routes: [] });
  });

  it("returns empty store when version is wrong", async () => {
    await fs.writeFile(
      storePath,
      JSON.stringify({ version: 99, messages: [], channels: [], routes: [] }),
      "utf-8",
    );
    const store = await readInboundStore(storePath);
    expect(store).toEqual({ version: 1, messages: [], channels: [], routes: [] });
  });

  it("returns empty store when messages is not an array", async () => {
    await fs.writeFile(
      storePath,
      JSON.stringify({ version: 1, messages: "not-array", channels: [], routes: [] }),
      "utf-8",
    );
    const store = await readInboundStore(storePath);
    expect(store).toEqual({ version: 1, messages: [], channels: [], routes: [] });
  });
});

// ---------------------------------------------------------------------------
// Store write
// ---------------------------------------------------------------------------

describe("writeInboundStore", () => {
  it("writes store file atomically", async () => {
    const data: InboundStoreFile = {
      version: 1,
      messages: [
        {
          id: "msg-1",
          source: { type: "slack", channelId: "ch2" },
          status: "queued",
          priority: "high",
          body: "Urgent request",
          createdAtMs: 2000,
          updatedAtMs: 2000,
        },
      ],
      channels: [],
      routes: [],
    };
    await writeInboundStore(storePath, data);
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].body).toBe("Urgent request");
  });

  it("creates parent directories if they don't exist", async () => {
    const deep = path.join(tmpDir, "a", "b", "c", "store.json");
    await writeInboundStore(deep, { version: 1, messages: [], channels: [], routes: [] });
    const raw = await fs.readFile(deep, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, messages: [], channels: [], routes: [] });
  });

  it("overwrites existing file", async () => {
    const initial: InboundStoreFile = { version: 1, messages: [], channels: [], routes: [] };
    await writeInboundStore(storePath, initial);

    const updated: InboundStoreFile = {
      version: 1,
      messages: [
        {
          id: "msg-2",
          source: { type: "email", channelId: "ch3" },
          status: "processed",
          priority: "low",
          body: "Follow up",
          createdAtMs: 3000,
          updatedAtMs: 3000,
        },
      ],
      channels: [],
      routes: [],
    };
    await writeInboundStore(storePath, updated);

    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].id).toBe("msg-2");
  });

  it("no .tmp file left behind after write", async () => {
    await writeInboundStore(storePath, { version: 1, messages: [], channels: [], routes: [] });
    const files = await fs.readdir(path.dirname(storePath));
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// emptyStore returns fresh arrays (not shared refs)
// ---------------------------------------------------------------------------

describe("emptyStore isolation", () => {
  it("returns independent arrays on each read from missing file", async () => {
    const store1 = await readInboundStore(path.join(tmpDir, "missing1.json"));
    const store2 = await readInboundStore(path.join(tmpDir, "missing2.json"));

    store1.messages.push({
      id: "injected",
      source: { type: "webhook", channelId: "x" },
      status: "pending",
      priority: "low",
      body: "test",
      createdAtMs: 0,
      updatedAtMs: 0,
    });

    expect(store2.messages).toHaveLength(0);
    expect(store1.messages).not.toBe(store2.messages);
    expect(store1.channels).not.toBe(store2.channels);
    expect(store1.routes).not.toBe(store2.routes);
  });
});
