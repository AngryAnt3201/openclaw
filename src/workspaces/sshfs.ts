// ---------------------------------------------------------------------------
// SSHFS mount helper – TypeScript implementation
// ---------------------------------------------------------------------------
// Mirrors the Rust sshfs_manager.rs logic. Runs sshfs in foreground mode (-f)
// so we keep a handle to the child process for lifecycle management.
// ---------------------------------------------------------------------------

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SshfsMount = {
  mountId: string;
  mountPoint: string;
  process: ChildProcess;
  sshHost: string;
  sshUser: string;
  remotePath: string;
};

export type MountSshfsInput = {
  sshHost: string;
  sshUser: string;
  sshKeyPath?: string;
  remotePath: string;
  deviceName: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

function mountBaseDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "mounts");
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

function resolveMountPoint(deviceName: string, remotePath: string): string {
  const base = mountBaseDir();
  const dirName = `${sanitizeName(deviceName)}-${shortHash(remotePath)}`;
  return path.join(base, dirName);
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export async function mountSshfs(input: MountSshfsInput): Promise<SshfsMount> {
  const mountPoint = resolveMountPoint(input.deviceName, input.remotePath);

  // Ensure mount point exists
  if (!existsSync(mountPoint)) {
    mkdirSync(mountPoint, { recursive: true });
  }

  const remote = `${input.sshUser}@${input.sshHost}:${input.remotePath}`;

  const sshOpts = [
    "reconnect",
    "ServerAliveInterval=5",
    "ServerAliveCountMax=3",
    "StrictHostKeyChecking=accept-new",
    "ConnectTimeout=10",
    "BatchMode=yes",
    "NumberOfPasswordPrompts=0",
  ];

  if (input.sshKeyPath) {
    sshOpts.push(`IdentityFile=${input.sshKeyPath}`);
  }

  const args: string[] = [
    remote,
    mountPoint,
    "-f", // foreground mode
    "-o",
    sshOpts.join(","),
  ];

  // macOS-specific FUSE options
  if (process.platform === "darwin") {
    args.push("-o", "local,noappledouble,noapplexattr,nobrowse,defer_permissions");
  }

  // Caching options
  args.push("-o", "cache=yes,auto_cache,entry_timeout=10,attr_timeout=10,negative_timeout=5");

  const child = spawn("sshfs", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const mountId = `${sanitizeName(input.deviceName)}-${shortHash(input.remotePath)}`;

  // Wait a bit for SFTP to establish, then verify
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      // Check if mount is accessible
      try {
        readdirSync(mountPoint);
        resolve();
      } catch {
        child.kill();
        reject(new Error(`SSHFS mount verification failed for ${remote}`));
      }
    }, 3000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start sshfs: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`sshfs exited with code ${code}`));
      }
    });
  });

  return {
    mountId,
    mountPoint,
    process: child,
    sshHost: input.sshHost,
    sshUser: input.sshUser,
    remotePath: input.remotePath,
  };
}

// ---------------------------------------------------------------------------
// Unmount
// ---------------------------------------------------------------------------

export async function unmountSshfs(mount: SshfsMount): Promise<void> {
  // Kill the foreground process
  if (mount.process && !mount.process.killed) {
    mount.process.kill("SIGTERM");
  }

  // Run platform unmount
  try {
    if (process.platform === "darwin") {
      execSync(
        `umount "${mount.mountPoint}" 2>/dev/null || diskutil unmount force "${mount.mountPoint}" 2>/dev/null`,
        {
          timeout: 10000,
        },
      );
    } else {
      execSync(
        `fusermount -u "${mount.mountPoint}" 2>/dev/null || umount "${mount.mountPoint}" 2>/dev/null`,
        {
          timeout: 10000,
        },
      );
    }
  } catch {
    // Best-effort unmount
  }

  // Clean up empty directory
  try {
    if (existsSync(mount.mountPoint)) {
      rmdirSync(mount.mountPoint);
    }
  } catch {
    // Directory may not be empty or still busy
  }
}

// ---------------------------------------------------------------------------
// Session environment for remote shell wrapper
// ---------------------------------------------------------------------------

export function sshfsSessionEnv(mount: SshfsMount, sshKeyPath?: string): Record<string, string> {
  const env: Record<string, string> = {
    SSHFS_REMOTE_HOST: `${mount.sshUser}@${mount.sshHost}`,
    SSHFS_REMOTE_CWD: mount.remotePath,
  };
  if (sshKeyPath) {
    env.SSHFS_REMOTE_KEY = sshKeyPath;
  }
  return env;
}
