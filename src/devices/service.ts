// ---------------------------------------------------------------------------
// DeviceService – Device registry management service
// ---------------------------------------------------------------------------
// Follows the LauncherService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import os from "node:os";
import type { Device, DeviceCreateInput, DevicePatch } from "./types.js";
import { readDeviceStore, writeDeviceStore } from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type DeviceServiceDeps = {
  storePath: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type DeviceServiceState = {
  deps: DeviceServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: DeviceServiceDeps): DeviceServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as LauncherService)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: DeviceServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// DeviceService
// ---------------------------------------------------------------------------

export class DeviceService {
  private readonly state: DeviceServiceState;

  constructor(deps: DeviceServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: DeviceCreateInput): Promise<Device> {
    return locked(this.state, async () => {
      const store = await readDeviceStore(this.state.deps.storePath);
      const now = this.now();

      const device: Device = {
        id: randomUUID(),
        name: input.name,
        type: input.type ?? "remote",
        status: "unknown",
        hostname: input.hostname ?? null,
        ip_address: input.ip_address ?? null,
        platform: input.platform ?? null,
        connection: {
          method: input.connection?.method ?? "local",
          ...input.connection,
        },
        is_default: input.is_default ?? false,
        tags: input.tags ?? [],
        notes: input.notes ?? "",
        createdAtMs: now,
        updatedAtMs: now,
        last_seen_at: null,
      };

      // If marking as default, unset other defaults
      if (device.is_default) {
        for (const d of store.devices) {
          d.is_default = false;
        }
      }

      store.devices.push(device);
      await writeDeviceStore(this.state.deps.storePath, store);

      this.emit("device.registry.created", device);
      this.state.deps.log.info(`device created: ${device.id} — ${device.name}`);

      return device;
    });
  }

  // -------------------------------------------------------------------------
  // update (partial patch)
  // -------------------------------------------------------------------------

  async update(deviceId: string, patch: DevicePatch): Promise<Device | null> {
    return locked(this.state, async () => {
      const store = await readDeviceStore(this.state.deps.storePath);
      const idx = store.devices.findIndex((d) => d.id === deviceId);
      if (idx === -1) {
        return null;
      }

      const device = store.devices[idx]!;

      if (patch.name !== undefined) {
        device.name = patch.name;
      }
      if (patch.type !== undefined) {
        device.type = patch.type;
      }
      if (patch.status !== undefined) {
        device.status = patch.status;
      }
      if (patch.hostname !== undefined) {
        device.hostname = patch.hostname;
      }
      if (patch.ip_address !== undefined) {
        device.ip_address = patch.ip_address;
      }
      if (patch.platform !== undefined) {
        device.platform = patch.platform;
      }
      if (patch.connection !== undefined) {
        device.connection = { ...device.connection, ...patch.connection };
      }
      if (patch.is_default !== undefined) {
        if (patch.is_default) {
          for (const d of store.devices) {
            d.is_default = false;
          }
        }
        device.is_default = patch.is_default;
      }
      if (patch.tags !== undefined) {
        device.tags = patch.tags;
      }
      if (patch.notes !== undefined) {
        device.notes = patch.notes;
      }
      if (patch.last_seen_at !== undefined) {
        device.last_seen_at = patch.last_seen_at;
      }
      device.updatedAtMs = this.now();

      store.devices[idx] = device;
      await writeDeviceStore(this.state.deps.storePath, store);

      this.emit("device.registry.updated", device);
      return device;
    });
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(deviceId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readDeviceStore(this.state.deps.storePath);
      const idx = store.devices.findIndex((d) => d.id === deviceId);
      if (idx === -1) {
        return false;
      }

      store.devices.splice(idx, 1);
      await writeDeviceStore(this.state.deps.storePath, store);

      this.emit("device.registry.deleted", { deviceId });
      this.state.deps.log.info(`device deleted: ${deviceId}`);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // list / get
  // -------------------------------------------------------------------------

  async list(): Promise<Device[]> {
    const store = await readDeviceStore(this.state.deps.storePath);
    return store.devices;
  }

  async get(deviceId: string): Promise<Device | null> {
    const store = await readDeviceStore(this.state.deps.storePath);
    return store.devices.find((d) => d.id === deviceId) ?? null;
  }

  // -------------------------------------------------------------------------
  // getDefault
  // -------------------------------------------------------------------------

  async getDefault(): Promise<Device | null> {
    const store = await readDeviceStore(this.state.deps.storePath);
    return store.devices.find((d) => d.is_default) ?? null;
  }

  // -------------------------------------------------------------------------
  // ensureLocalDevice — auto-create local device if none exists
  // -------------------------------------------------------------------------

  async ensureLocalDevice(): Promise<Device> {
    return locked(this.state, async () => {
      const store = await readDeviceStore(this.state.deps.storePath);
      const local = store.devices.find((d) => d.type === "local");
      if (local) {
        return local;
      }

      const now = this.now();
      const device: Device = {
        id: randomUUID(),
        name: os.hostname(),
        type: "local",
        status: "online",
        hostname: os.hostname(),
        ip_address: null,
        platform: os.platform(),
        connection: { method: "local" },
        is_default: store.devices.length === 0,
        tags: [os.arch()],
        notes: "",
        createdAtMs: now,
        updatedAtMs: now,
        last_seen_at: new Date(now).toISOString(),
      };

      store.devices.push(device);
      await writeDeviceStore(this.state.deps.storePath, store);

      this.emit("device.registry.created", device);
      this.state.deps.log.info(`local device auto-created: ${device.id} — ${device.name}`);
      return device;
    });
  }
}
