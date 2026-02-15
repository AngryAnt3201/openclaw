// ---------------------------------------------------------------------------
// Device Registry – Core Types
// ---------------------------------------------------------------------------

export type DeviceStatus = "online" | "offline" | "unknown";
export type DeviceType = "local" | "remote";

export type DeviceConnection = {
  method: "local" | "ssh" | "websocket";
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_key_path?: string;
  ws_url?: string;
};

export type Device = {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  hostname: string | null;
  ip_address: string | null;
  platform: string | null; // "darwin" | "linux" | "windows"
  connection: DeviceConnection;
  is_default: boolean;
  tags: string[];
  notes: string;
  createdAtMs: number;
  updatedAtMs: number;
  last_seen_at: string | null;
};

export type DeviceStoreFile = {
  version: 1;
  devices: Device[];
};

// ---------------------------------------------------------------------------
// Create input
// ---------------------------------------------------------------------------

export type DeviceCreateInput = {
  name: string;
  type?: DeviceType;
  hostname?: string | null;
  ip_address?: string | null;
  platform?: string | null;
  connection?: Partial<DeviceConnection>;
  is_default?: boolean;
  tags?: string[];
  notes?: string;
};

// ---------------------------------------------------------------------------
// Patch (partial update)
// ---------------------------------------------------------------------------

export type DevicePatch = {
  name?: string;
  type?: DeviceType;
  status?: DeviceStatus;
  hostname?: string | null;
  ip_address?: string | null;
  platform?: string | null;
  connection?: Partial<DeviceConnection>;
  is_default?: boolean;
  tags?: string[];
  notes?: string;
  last_seen_at?: string | null;
};
