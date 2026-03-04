// ---------------------------------------------------------------------------
// Workspace resolution hook – global singleton
// ---------------------------------------------------------------------------
// Registered by server.impl.ts when the gateway starts. Called by get-reply.ts
// to auto-activate and resolve workspace directories for agent sessions.
// ---------------------------------------------------------------------------

export type WorkspaceResolveHook = (sessionKey: string, agentId?: string) => Promise<string | null>;

/**
 * Returns the list of remote directory paths the agent is allowed to access.
 * Empty array = no workspace bound (no file access). null = hook not registered.
 */
export type WorkspaceAllowedPathsHook = (sessionKey: string, agentId?: string) => Promise<string[]>;

let _hook: WorkspaceResolveHook | null = null;
let _allowedPathsHook: WorkspaceAllowedPathsHook | null = null;

/**
 * Register the workspace resolve hook. Called once during gateway startup.
 */
export function registerWorkspaceResolveHook(hook: WorkspaceResolveHook): void {
  _hook = hook;
}

/**
 * Register the allowed-paths hook. Called once during gateway startup.
 */
export function registerWorkspaceAllowedPathsHook(hook: WorkspaceAllowedPathsHook): void {
  _allowedPathsHook = hook;
}

/**
 * Resolve the workspace directory for an agent session.
 * Returns the local mount path of the primary directory, or null if no
 * workspace is bound. Auto-activates the workspace if needed.
 */
export async function resolveWorkspaceDirForSession(
  sessionKey: string,
  agentId?: string,
): Promise<string | null> {
  if (!_hook) {
    return null;
  }
  try {
    return await _hook(sessionKey, agentId);
  } catch {
    return null;
  }
}

/**
 * Resolve the allowed file paths for an agent session.
 * Returns the remote directory paths from the bound workspace.
 * Empty array = no access allowed.
 */
export async function resolveAllowedFilePathsForSession(
  sessionKey: string,
  agentId?: string,
): Promise<string[]> {
  if (!_allowedPathsHook) {
    return [];
  }
  try {
    return await _allowedPathsHook(sessionKey, agentId);
  } catch {
    return [];
  }
}
