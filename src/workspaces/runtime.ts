// ---------------------------------------------------------------------------
// WorkspaceRuntime – In-memory mount lifecycle manager
// ---------------------------------------------------------------------------
// Manages the activation/deactivation of workspaces, including SSHFS mounts.
// Each active workspace has a runtime state tracking mounts and status.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import * as os from "node:os";
import type { Workspace, WorkspaceDirectory, WorkspaceRuntimeState, MountState } from "./types.js";
import { mountSshfs, unmountSshfs, type SshfsMount } from "./sshfs.js";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type WorkspaceRuntimeDeps = {
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
};

// ---------------------------------------------------------------------------
// WorkspaceRuntime
// ---------------------------------------------------------------------------

export class WorkspaceRuntime {
  private readonly deps: WorkspaceRuntimeDeps;
  private readonly states = new Map<string, WorkspaceRuntimeState>();
  private readonly mounts = new Map<string, SshfsMount>(); // key: directoryId

  constructor(deps: WorkspaceRuntimeDeps) {
    this.deps = deps;
  }

  /**
   * Activate a workspace: mount SSHFS dirs, validate local dirs.
   * Called automatically when an agent resolves a workspace — no manual step needed.
   */
  async activate(workspace: Workspace): Promise<WorkspaceRuntimeState> {
    const existing = this.states.get(workspace.id);
    if (existing && (existing.status === "active" || existing.status === "activating")) {
      return existing;
    }

    const state: WorkspaceRuntimeState = {
      workspaceId: workspace.id,
      status: "activating",
      mounts: [],
      activatedAtMs: Date.now(),
    };
    this.states.set(workspace.id, state);
    this.deps.broadcast("workspace.status.changed", {
      workspaceId: workspace.id,
      status: "activating",
    });

    try {
      for (const dir of workspace.directories) {
        const mountState = await this.mountDirectory(dir, workspace);
        state.mounts.push(mountState);
      }

      const hasErrors = state.mounts.some((m) => m.status === "error");
      state.status = hasErrors ? "error" : "active";
      if (hasErrors) {
        state.errorMessage = "Some directories failed to mount";
      }
    } catch (err) {
      state.status = "error";
      state.errorMessage = err instanceof Error ? err.message : String(err);
    }

    this.states.set(workspace.id, state);
    this.deps.broadcast("workspace.status.changed", {
      workspaceId: workspace.id,
      status: state.status,
    });

    if (state.status === "active") {
      this.deps.broadcast("workspace.activated", { workspaceId: workspace.id });
      this.deps.log.info(`workspace activated: ${workspace.id} — ${workspace.name}`);
    } else {
      this.deps.log.error(`workspace activation failed: ${workspace.id} — ${state.errorMessage}`);
    }

    return state;
  }

  /**
   * Deactivate a workspace: unmount all SSHFS mounts.
   */
  async deactivate(workspaceId: string): Promise<void> {
    const state = this.states.get(workspaceId);
    if (!state) {
      return;
    }

    for (const mountState of state.mounts) {
      const mount = this.mounts.get(mountState.directoryId);
      if (mount) {
        try {
          await unmountSshfs(mount);
        } catch (err) {
          this.deps.log.warn(
            `failed to unmount ${mountState.directoryId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        this.mounts.delete(mountState.directoryId);
      }
    }

    this.states.delete(workspaceId);
    this.deps.broadcast("workspace.deactivated", { workspaceId });
    this.deps.broadcast("workspace.status.changed", { workspaceId, status: "inactive" });
    this.deps.log.info(`workspace deactivated: ${workspaceId}`);
  }

  /**
   * Deactivate all workspaces (cleanup on gateway shutdown).
   */
  async deactivateAll(): Promise<void> {
    const ids = [...this.states.keys()];
    for (const id of ids) {
      await this.deactivate(id);
    }
  }

  /**
   * Get runtime state for a workspace.
   */
  getState(workspaceId: string): WorkspaceRuntimeState | null {
    return this.states.get(workspaceId) ?? null;
  }

  /**
   * Resolve the local mount path for the primary directory of a workspace.
   */
  resolvePrimaryDir(workspaceId: string): string | null {
    const state = this.states.get(workspaceId);
    if (!state || state.status !== "active") {
      return null;
    }

    const primaryMount = state.mounts.find((m) => m.status === "mounted");
    if (!primaryMount) {
      return null;
    }

    return primaryMount.mountPoint;
  }

  /**
   * Resolve the local mount path for a specific directory.
   */
  resolveDir(workspaceId: string, directoryId: string): string | null {
    const state = this.states.get(workspaceId);
    if (!state) {
      return null;
    }

    const mountState = state.mounts.find((m) => m.directoryId === directoryId);
    if (!mountState || mountState.status !== "mounted") {
      return null;
    }

    return mountState.mountPoint;
  }

  /**
   * Resolve SSH exec info for remote command execution (bypasses FUSE).
   */
  resolveRemoteExec(
    workspaceId: string,
    directoryId: string,
  ): { sshHost: string; sshUser: string; remotePath: string } | null {
    const mount = this.mounts.get(directoryId);
    if (!mount) {
      return null;
    }

    return {
      sshHost: mount.sshHost,
      sshUser: mount.sshUser,
      remotePath: mount.remotePath,
    };
  }

  // =========================================================================
  // Private
  // =========================================================================

  private async mountDirectory(dir: WorkspaceDirectory, workspace: Workspace): Promise<MountState> {
    if (dir.mountMethod === "local" || dir.deviceId === "local") {
      // Local directory — just validate it exists
      if (existsSync(dir.remotePath)) {
        return {
          directoryId: dir.id,
          mountPoint: dir.remotePath,
          mountId: `local-${dir.id}`,
          status: "mounted",
        };
      }
      return {
        directoryId: dir.id,
        mountPoint: dir.remotePath,
        mountId: `local-${dir.id}`,
        status: "error",
        errorMessage: `Local directory does not exist: ${dir.remotePath}`,
      };
    }

    if (dir.mountMethod === "ssh-exec") {
      // SSH exec mode — no FUSE mount, commands are routed via SSH
      return {
        directoryId: dir.id,
        mountPoint: dir.remotePath,
        mountId: `ssh-exec-${dir.id}`,
        status: "mounted",
      };
    }

    // Check if the remote host IS this machine (gateway) — skip SSHFS, use path directly
    const { sshUser, sshHost, sshKeyPath } = this.parseDeviceConnection(dir.deviceId);
    if (this.isLocalHost(sshHost)) {
      this.deps.log.info(`directory ${dir.label} is on this machine — using path directly`);
      if (existsSync(dir.remotePath)) {
        return {
          directoryId: dir.id,
          mountPoint: dir.remotePath,
          mountId: `local-${dir.id}`,
          status: "mounted",
        };
      }
      return {
        directoryId: dir.id,
        mountPoint: dir.remotePath,
        mountId: `local-${dir.id}`,
        status: "error",
        errorMessage: `Directory does not exist on gateway: ${dir.remotePath}`,
      };
    }

    // SSHFS mount for truly remote directories
    try {
      const mount = await mountSshfs({
        sshHost,
        sshUser,
        sshKeyPath,
        remotePath: dir.remotePath,
        deviceName: `${workspace.name}-${dir.label}`,
      });

      this.mounts.set(dir.id, mount);

      this.deps.log.info(`SSHFS mounted: ${dir.label} → ${mount.mountPoint}`);

      return {
        directoryId: dir.id,
        mountPoint: mount.mountPoint,
        mountId: mount.mountId,
        status: "mounted",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.log.error(`SSHFS mount failed for ${dir.label}: ${msg}`);
      return {
        directoryId: dir.id,
        mountPoint: "",
        mountId: "",
        status: "error",
        errorMessage: msg,
      };
    }
  }

  /**
   * Parse device connection info from deviceId.
   * In the future this will look up the Device registry;
   * for now, deviceId is expected as "user@host" or "host".
   */
  private parseDeviceConnection(deviceId: string): {
    sshUser: string;
    sshHost: string;
    sshKeyPath?: string;
  } {
    if (deviceId.includes("@")) {
      const [user, host] = deviceId.split("@", 2);
      return { sshUser: user!, sshHost: host! };
    }
    return { sshUser: "root", sshHost: deviceId };
  }

  /**
   * Check if a host refers to this machine (the gateway).
   * Matches localhost, loopback, the machine's hostname, and any local IP.
   */
  private isLocalHost(host: string): boolean {
    const lower = host.toLowerCase();
    if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") {
      return true;
    }

    const hostname = os.hostname().toLowerCase();
    if (lower === hostname) {
      return true;
    }

    // Check against all local network interfaces
    try {
      const ifaces = os.networkInterfaces();
      for (const addrs of Object.values(ifaces)) {
        if (!addrs) {
          continue;
        }
        for (const addr of addrs) {
          if (addr.address === host) {
            return true;
          }
        }
      }
    } catch {
      /* ignore */
    }

    return false;
  }
}
