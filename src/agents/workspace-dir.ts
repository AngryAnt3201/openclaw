// ---------------------------------------------------------------------------
// workspace-dir – resolve the agent workspace root directory
// ---------------------------------------------------------------------------

import path from "node:path";

/**
 * Normalize a workspace directory string to a resolved absolute path,
 * or `null` if the input is empty/undefined.
 */
export function normalizeWorkspaceDir(workspaceDir?: string): string | null {
  const trimmed = workspaceDir?.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(trimmed);
}

/**
 * Resolve the workspace root directory.  Falls back to `process.cwd()` when
 * no explicit directory is provided (or when it's empty).
 */
export function resolveWorkspaceRoot(workspaceDir?: string): string {
  return normalizeWorkspaceDir(workspaceDir) ?? process.cwd();
}
