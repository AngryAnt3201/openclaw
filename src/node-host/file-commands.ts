import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modifiedAtMs: number;
  permissions?: string;
};

export type FileListParams = {
  path: string;
  hidden?: boolean;
  limit?: number;
};

export type FileReadParams = {
  path: string;
  offset?: number;
  limit?: number;
  encoding?: "utf8" | "base64";
};

export type FileStatParams = {
  path: string;
};

export type FileListResult = {
  entries: FileEntry[];
  path: string;
  truncated: boolean;
};

export type FileReadResult = {
  content: string;
  size: number;
  truncated: boolean;
  encoding: "utf8" | "base64";
};

export type FileStatResult = {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAtMs: number;
  createdAtMs: number;
  permissions: string;
};

const MAX_READ_BYTES = 1024 * 1024; // 1MB
const MAX_LIST_ENTRIES = 1000;

// Paths that are always denied for security
const DENIED_PATHS = [
  "/.ssh",
  "/.gnupg",
  "/.gnome-keyring",
  "/.config/openclaw/credentials",
  "/.openclaw/credentials",
];

function isDeniedPath(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, "/");
  const home = os.homedir().replace(/\\/g, "/");
  for (const denied of DENIED_PATHS) {
    const fullDenied = home + denied;
    if (normalized === fullDenied || normalized.startsWith(fullDenied + "/")) {
      return true;
    }
  }
  return false;
}

function resolvePath(rawPath: string): string {
  let resolved = rawPath;
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  return path.resolve(resolved);
}

function formatPermissions(mode: number): string {
  const perms = [
    mode & 0o400 ? "r" : "-",
    mode & 0o200 ? "w" : "-",
    mode & 0o100 ? "x" : "-",
    mode & 0o040 ? "r" : "-",
    mode & 0o020 ? "w" : "-",
    mode & 0o010 ? "x" : "-",
    mode & 0o004 ? "r" : "-",
    mode & 0o002 ? "w" : "-",
    mode & 0o001 ? "x" : "-",
  ];
  return perms.join("");
}

export async function handleFileList(params: FileListParams): Promise<FileListResult> {
  const targetPath = resolvePath(params.path);
  if (isDeniedPath(targetPath)) {
    throw new Error("PERMISSION_DENIED: access to this path is restricted");
  }

  const showHidden = params.hidden ?? false;
  const limit = Math.min(params.limit ?? MAX_LIST_ENTRIES, MAX_LIST_ENTRIES);

  const dirEntries = await fs.readdir(targetPath, { withFileTypes: true });
  const entries: FileEntry[] = [];
  let truncated = false;

  for (const entry of dirEntries) {
    if (!showHidden && entry.name.startsWith(".")) {
      continue;
    }
    if (entries.length >= limit) {
      truncated = true;
      break;
    }

    const fullPath = path.join(targetPath, entry.name);
    let size = 0;
    let modifiedAtMs = 0;
    let permissions: string | undefined;

    try {
      const stat = await fs.lstat(fullPath);
      size = stat.size;
      modifiedAtMs = stat.mtimeMs;
      permissions = formatPermissions(stat.mode);
    } catch {
      // Skip entries we can't stat
    }

    let type: FileEntry["type"] = "file";
    if (entry.isDirectory()) {
      type = "directory";
    } else if (entry.isSymbolicLink()) {
      type = "symlink";
    }

    entries.push({
      name: entry.name,
      path: fullPath,
      type,
      size,
      modifiedAtMs,
      permissions,
    });
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") {
      return -1;
    }
    if (a.type !== "directory" && b.type === "directory") {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });

  return { entries, path: targetPath, truncated };
}

export async function handleFileRead(params: FileReadParams): Promise<FileReadResult> {
  const targetPath = resolvePath(params.path);
  if (isDeniedPath(targetPath)) {
    throw new Error("PERMISSION_DENIED: access to this path is restricted");
  }

  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error("INVALID_REQUEST: path is not a file");
  }

  const encoding = params.encoding ?? "utf8";
  const offset = params.offset ?? 0;
  const limit = Math.min(params.limit ?? MAX_READ_BYTES, MAX_READ_BYTES);

  const fd = await fs.open(targetPath, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await fd.read(buffer, 0, limit, offset);
    const content =
      encoding === "base64"
        ? buffer.subarray(0, bytesRead).toString("base64")
        : buffer.subarray(0, bytesRead).toString("utf8");

    return {
      content,
      size: stat.size,
      truncated: offset + bytesRead < stat.size,
      encoding,
    };
  } finally {
    await fd.close();
  }
}

export async function handleFileStat(params: FileStatParams): Promise<FileStatResult> {
  const targetPath = resolvePath(params.path);
  if (isDeniedPath(targetPath)) {
    throw new Error("PERMISSION_DENIED: access to this path is restricted");
  }

  const stat = await fs.lstat(targetPath);
  let type: FileStatResult["type"] = "other";
  if (stat.isFile()) {
    type = "file";
  } else if (stat.isDirectory()) {
    type = "directory";
  } else if (stat.isSymbolicLink()) {
    type = "symlink";
  }

  return {
    name: path.basename(targetPath),
    path: targetPath,
    type,
    size: stat.size,
    modifiedAtMs: stat.mtimeMs,
    createdAtMs: stat.birthtimeMs,
    permissions: formatPermissions(stat.mode),
  };
}
