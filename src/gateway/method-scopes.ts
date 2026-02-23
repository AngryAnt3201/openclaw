export const ADMIN_SCOPE = "operator.admin" as const;
export const READ_SCOPE = "operator.read" as const;
export const WRITE_SCOPE = "operator.write" as const;
export const APPROVALS_SCOPE = "operator.approvals" as const;
export const PAIRING_SCOPE = "operator.pairing" as const;

export type OperatorScope =
  | typeof ADMIN_SCOPE
  | typeof READ_SCOPE
  | typeof WRITE_SCOPE
  | typeof APPROVALS_SCOPE
  | typeof PAIRING_SCOPE;

export const CLI_DEFAULT_OPERATOR_SCOPES: OperatorScope[] = [
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
];

const NODE_ROLE_METHODS = new Set(["node.invoke.result", "node.event", "skills.bins"]);

const METHOD_SCOPE_GROUPS: Record<OperatorScope, readonly string[]> = {
  [APPROVALS_SCOPE]: [
    "exec.approval.request",
    "exec.approval.waitDecision",
    "exec.approval.resolve",
  ],
  [PAIRING_SCOPE]: [
    "node.pair.request",
    "node.pair.list",
    "node.pair.approve",
    "node.pair.reject",
    "node.pair.verify",
    "device.pair.list",
    "device.pair.approve",
    "device.pair.reject",
    "device.pair.remove",
    "device.token.rotate",
    "device.token.revoke",
    "node.rename",
  ],
  [READ_SCOPE]: [
    "health",
    "logs.tail",
    "channels.status",
    "status",
    "usage.status",
    "usage.cost",
    "tts.status",
    "tts.providers",
    "models.list",
    "agents.list",
    "agent.identity.get",
    "skills.status",
    "voicewake.get",
    "sessions.list",
    "sessions.preview",
    "sessions.resolve",
    "sessions.usage",
    "sessions.usage.timeseries",
    "sessions.usage.logs",
    "cron.list",
    "cron.status",
    "cron.runs",
    "system-presence",
    "last-heartbeat",
    "node.list",
    "node.describe",
    "chat.history",
    "config.get",
    "talk.config",
    "agents.files.list",
    "agents.files.get",
    "file.list",
    "file.read",
    "file.stat",
    "clawhub.search",
    "clawhub.inspect",
    "browser.snapshot",
    "browser.tabs",
    "task.list",
    "task.get",
    "task.events",
    "task.progress",
    "task.statusUpdates",
    "notification.list",
    "notification.get",
    "notification.unreadCount",
    "notification.preferences.get",
    "notification.channels.list",
    "launcher.list",
    "launcher.get",
    "launcher.health",
    "launcher.discovered.list",
    "vault.list",
    "vault.get",
    "vault.search",
    "vault.graph",
    "vault.backlinks",
    "vault.tree",
    "vault.tags",
    "vault.daily",
    "vault.metadata",
    "vault.canvas.get",
    "vault.config",
    "plugins.list",
    "device.registry.list",
    "device.registry.get",
    "workflow.get",
    "workflow.list",
    "workflow.events",
    "workflow.policies.get",
    "pr.get",
    "pr.list",
    "pr.checks",
    "issue.get",
    "issue.list",
    "review.diff",
    "credential.list",
    "credential.get",
    "credential.detect",
    "account.list",
    "account.get",
    "agent.profile.get",
    "agent.profile.list",
    "agent.profile.resolve",
    "pipeline.list",
    "pipeline.get",
    "pipeline.runs",
    "node.registry.list",
    "widget.registry.list",
    "widget.registry.get",
    "widget.instance.list",
    "widget.data.stream.list",
    "widget.data.stream.get",
    "kb.list",
    "kb.get",
    "kb.search",
    "kb.tags",
    "kb.config.get",
    "kb.open",
    "kb.open.note",
    "kb.status",
  ],
  [WRITE_SCOPE]: [
    "send",
    "poll",
    "agent",
    "agent.wait",
    "wake",
    "talk.mode",
    "tts.enable",
    "tts.disable",
    "tts.convert",
    "tts.setProvider",
    "voicewake.set",
    "node.invoke",
    "chat.send",
    "chat.abort",
    "browser.request",
    "push.test",
    "task.create",
    "task.update",
    "task.cancel",
    "task.respond",
    "task.approve",
    "task.reject",
    "task.delete",
    "task.clearFinished",
    "task.statusUpdate.create",
    "notification.create",
    "notification.markRead",
    "notification.markAllRead",
    "notification.dismiss",
    "notification.dismissAll",
    "notification.preferences.set",
    "launcher.create",
    "launcher.update",
    "launcher.delete",
    "launcher.pin",
    "launcher.unpin",
    "launcher.reorder",
    "launcher.discovered.update",
    "launcher.start",
    "launcher.stop",
    "launcher.icon.upload",
    "vault.create",
    "vault.update",
    "vault.delete",
    "vault.move",
    "vault.canvas.update",
    "vault.sync.trigger",
    "workflow.create",
    "workflow.pause",
    "workflow.resume",
    "workflow.cancel",
    "workflow.retry_step",
    "workflow.delete",
    "workflow.policies.update",
    "pr.create",
    "pr.update",
    "pr.merge",
    "pr.comment",
    "issue.create",
    "issue.update",
    "issue.close",
    "issue.comment",
    "issue.to_workflow",
    "review.run",
    "credential.create",
    "credential.update",
    "credential.delete",
    "credential.rotate",
    "credential.enable",
    "credential.disable",
    "credential.grant",
    "credential.revoke",
    "credential.lease.create",
    "credential.lease.revoke",
    "credential.rule.add",
    "credential.rule.update",
    "credential.rule.remove",
    "credential.checkout",
    "credential.import",
    "credential.createFromPaste",
    "account.create",
    "account.update",
    "account.delete",
    "account.addCredential",
    "account.removeCredential",
    "agent.profile.bind",
    "agent.profile.unbind",
    "pipeline.create",
    "pipeline.update",
    "pipeline.delete",
    "pipeline.activate",
    "pipeline.deactivate",
    "pipeline.run",
    "widget.registry.create",
    "widget.registry.delete",
    "widget.instance.spawn",
    "widget.instance.dismiss",
    "widget.instance.update",
    "widget.data.push",
    "widget.data.stream.create",
    "widget.data.stream.push",
    "widget.data.stream.delete",
    "kb.create",
    "kb.config.set",
  ],
  [ADMIN_SCOPE]: [
    "channels.logout",
    "agents.create",
    "agents.update",
    "agents.delete",
    "skills.install",
    "skills.update",
    "cron.add",
    "cron.update",
    "cron.remove",
    "cron.run",
    "sessions.patch",
    "sessions.reset",
    "sessions.delete",
    "sessions.compact",
    "connect",
    "chat.inject",
    "web.login.start",
    "web.login.wait",
    "set-heartbeats",
    "system-event",
    "agents.files.set",
    "clawhub.install",
    "plugins.reload",
    "device.registry.create",
    "device.registry.update",
    "device.registry.delete",
  ],
};

const ADMIN_METHOD_PREFIXES = ["exec.approvals.", "config.", "wizard.", "update."] as const;

const METHOD_SCOPE_BY_NAME = new Map<string, OperatorScope>(
  Object.entries(METHOD_SCOPE_GROUPS).flatMap(([scope, methods]) =>
    methods.map((method) => [method, scope as OperatorScope]),
  ),
);

function resolveScopedMethod(method: string): OperatorScope | undefined {
  const explicitScope = METHOD_SCOPE_BY_NAME.get(method);
  if (explicitScope) {
    return explicitScope;
  }
  if (ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return ADMIN_SCOPE;
  }
  return undefined;
}

export function isApprovalMethod(method: string): boolean {
  return resolveScopedMethod(method) === APPROVALS_SCOPE;
}

export function isPairingMethod(method: string): boolean {
  return resolveScopedMethod(method) === PAIRING_SCOPE;
}

export function isReadMethod(method: string): boolean {
  return resolveScopedMethod(method) === READ_SCOPE;
}

export function isWriteMethod(method: string): boolean {
  return resolveScopedMethod(method) === WRITE_SCOPE;
}

export function isNodeRoleMethod(method: string): boolean {
  return NODE_ROLE_METHODS.has(method);
}

export function isAdminOnlyMethod(method: string): boolean {
  return resolveScopedMethod(method) === ADMIN_SCOPE;
}

export function resolveRequiredOperatorScopeForMethod(method: string): OperatorScope | undefined {
  return resolveScopedMethod(method);
}

export function resolveLeastPrivilegeOperatorScopesForMethod(method: string): OperatorScope[] {
  const requiredScope = resolveRequiredOperatorScopeForMethod(method);
  if (requiredScope) {
    return [requiredScope];
  }
  // Default-deny for unclassified methods.
  return [];
}

export function authorizeOperatorScopesForMethod(
  method: string,
  scopes: readonly string[],
): { allowed: true } | { allowed: false; missingScope: OperatorScope } {
  if (scopes.includes(ADMIN_SCOPE)) {
    return { allowed: true };
  }
  const requiredScope = resolveRequiredOperatorScopeForMethod(method) ?? ADMIN_SCOPE;
  if (requiredScope === READ_SCOPE) {
    if (scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE)) {
      return { allowed: true };
    }
    return { allowed: false, missingScope: READ_SCOPE };
  }
  if (scopes.includes(requiredScope)) {
    return { allowed: true };
  }
  return { allowed: false, missingScope: requiredScope };
}

export function isGatewayMethodClassified(method: string): boolean {
  if (isNodeRoleMethod(method)) {
    return true;
  }
  return resolveRequiredOperatorScopeForMethod(method) !== undefined;
}
