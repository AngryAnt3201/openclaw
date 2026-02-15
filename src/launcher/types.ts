// ---------------------------------------------------------------------------
// Launcher System – Core Types
// ---------------------------------------------------------------------------

export type AppCategory = "native" | "dev-server" | "web-embed" | "custom" | "service" | "script";
export type LaunchStatus = "stopped" | "starting" | "running" | "error";

// ---------------------------------------------------------------------------
// LaunchableApp – full entity (superset of frontend LaunchableApp)
// ---------------------------------------------------------------------------

export type LaunchableApp = {
  id: string;
  name: string;
  description: string;
  category: AppCategory;
  icon: string;
  icon_path: string | null;
  pinned: boolean;
  pinned_order: number;
  status: LaunchStatus;
  last_launched_at: string | null;

  // Native app fields
  bundle_id: string | null;
  app_path: string | null;

  // Dev server fields
  run_command: string | null;
  working_dir: string | null;
  port: number | null;
  session_id: number | null;
  maestro_app_id: string | null;

  // Web embed fields
  url: string | null;

  // Device association
  device_id: string | null;

  // Extended fields
  env_vars: Record<string, string> | null;
  health_check_url: string | null;

  tags: string[];
  color: string | null;

  // Timestamps
  createdAtMs: number;
  updatedAtMs: number;
};

// ---------------------------------------------------------------------------
// DiscoveredApp – scanned native apps from macOS
// ---------------------------------------------------------------------------

export type DiscoveredApp = {
  name: string;
  bundle_id: string;
  path: string;
  icon_path: string | null;
};

// ---------------------------------------------------------------------------
// Create input
// ---------------------------------------------------------------------------

export type LaunchableAppCreateInput = {
  name: string;
  description?: string;
  category?: AppCategory;
  icon?: string;
  icon_path?: string | null;
  pinned?: boolean;
  pinned_order?: number;

  // Native
  bundle_id?: string | null;
  app_path?: string | null;

  // Dev server
  run_command?: string | null;
  working_dir?: string | null;
  port?: number | null;
  maestro_app_id?: string | null;

  // Web embed
  url?: string | null;

  // Device association
  device_id?: string | null;

  // Extended fields
  env_vars?: Record<string, string> | null;
  health_check_url?: string | null;

  tags?: string[];
  color?: string | null;
};

// ---------------------------------------------------------------------------
// Patch (partial update)
// ---------------------------------------------------------------------------

export type LaunchableAppPatch = {
  name?: string;
  description?: string;
  category?: AppCategory;
  icon?: string;
  icon_path?: string | null;
  pinned?: boolean;
  pinned_order?: number;
  status?: LaunchStatus;
  last_launched_at?: string | null;

  bundle_id?: string | null;
  app_path?: string | null;
  run_command?: string | null;
  working_dir?: string | null;
  port?: number | null;
  maestro_app_id?: string | null;
  url?: string | null;

  device_id?: string | null;
  env_vars?: Record<string, string> | null;
  health_check_url?: string | null;

  tags?: string[];
  color?: string | null;
};

// ---------------------------------------------------------------------------
// Filter (for list queries)
// ---------------------------------------------------------------------------

export type LauncherFilter = {
  category?: AppCategory;
  pinned?: boolean;
  device_id?: string;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Store file shape (persisted to disk)
// ---------------------------------------------------------------------------

export type LauncherStoreFile = {
  version: 1;
  apps: LaunchableApp[];
  discoveredApps: DiscoveredApp[];
};
