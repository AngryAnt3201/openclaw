// ---------------------------------------------------------------------------
// Workspace resolution hook – global singleton
// ---------------------------------------------------------------------------
// Registered by server.impl.ts when the gateway starts. Called by get-reply.ts
// to auto-activate and resolve workspace directories for agent sessions.
// ---------------------------------------------------------------------------

export type WorkspaceResolveHook = (sessionKey: string, agentId?: string) => Promise<string | null>;

let _hook: WorkspaceResolveHook | null = null;

/**
 * Register the workspace resolve hook. Called once during gateway startup.
 */
export function registerWorkspaceResolveHook(hook: WorkspaceResolveHook): void {
  _hook = hook;
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
