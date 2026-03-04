// ---------------------------------------------------------------------------
// Remote Workspaces – Core Types
// ---------------------------------------------------------------------------
// Const arrays are the single source of truth. Types are derived from them
// so runtime validation and compile-time types stay in sync automatically.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mount methods
// ---------------------------------------------------------------------------

export const MOUNT_METHODS = ["local", "sshfs", "ssh-exec"] as const;

export type MountMethod = (typeof MOUNT_METHODS)[number];

export const VALID_MOUNT_METHODS = new Set<string>(MOUNT_METHODS);

// ---------------------------------------------------------------------------
// Workspace directory – a single directory in a workspace
// ---------------------------------------------------------------------------

export type WorkspaceDirectory = {
  id: string;
  deviceId: string;
  remotePath: string;
  label: string;
  mountMethod: MountMethod;
  primary: boolean;
};

// ---------------------------------------------------------------------------
// Workspace binding – links a workspace to an agent or session
// ---------------------------------------------------------------------------

export type WorkspaceBinding = {
  agentId?: string;
  sessionKey?: string;
  boundAtMs: number;
};

// ---------------------------------------------------------------------------
// Workspace – top-level workspace object
// ---------------------------------------------------------------------------

export type Workspace = {
  id: string;
  name: string;
  description: string;
  directories: WorkspaceDirectory[];
  bindings: WorkspaceBinding[];
  tags: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

// ---------------------------------------------------------------------------
// Store file shape (persisted to disk)
// ---------------------------------------------------------------------------

export type WorkspaceStoreFile = {
  version: 1;
  workspaces: Workspace[];
};

// ---------------------------------------------------------------------------
// Creation / patch inputs
// ---------------------------------------------------------------------------

export type WorkspaceCreateInput = {
  name: string;
  description?: string;
  directories?: WorkspaceDirectoryInput[];
  tags?: string[];
};

export type WorkspacePatch = {
  name?: string;
  description?: string;
  tags?: string[];
};

export type WorkspaceDirectoryInput = {
  deviceId: string;
  remotePath: string;
  label: string;
  mountMethod?: MountMethod;
  primary?: boolean;
};

// ---------------------------------------------------------------------------
// Filter for list queries
// ---------------------------------------------------------------------------

export type WorkspaceFilter = {
  tag?: string;
  deviceId?: string;
  agentId?: string;
  sessionKey?: string;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Runtime state (in-memory, not persisted)
// ---------------------------------------------------------------------------

export const WORKSPACE_STATUSES = ["inactive", "activating", "active", "error"] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export type MountState = {
  directoryId: string;
  mountPoint: string;
  mountId: string;
  status: "mounted" | "unmounting" | "error";
  errorMessage?: string;
};

export type WorkspaceRuntimeState = {
  workspaceId: string;
  status: WorkspaceStatus;
  mounts: MountState[];
  activatedAtMs: number;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Workspace event types
// ---------------------------------------------------------------------------

export const WORKSPACE_EVENT_TYPES = [
  "workspace.created",
  "workspace.updated",
  "workspace.deleted",
  "workspace.directory.added",
  "workspace.directory.removed",
  "workspace.binding.changed",
  "workspace.activated",
  "workspace.deactivated",
  "workspace.status.changed",
] as const;

export type WorkspaceEventType = (typeof WORKSPACE_EVENT_TYPES)[number];
