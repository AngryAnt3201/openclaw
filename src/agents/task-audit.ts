// ---------------------------------------------------------------------------
// Task Audit Trail – Logs every tool invocation and policy decision
// ---------------------------------------------------------------------------
// Stored in the task event log alongside regular events.
// Each entry captures the tool call, policy check result, and consumption.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { TaskEvent } from "../tasks/types.js";
import { appendTaskEvent } from "../tasks/store.js";

export type AuditCategory =
  | "tool_invocation"
  | "policy_check"
  | "approval_flow"
  | "budget_check"
  | "budget_exceeded";

export type AuditOutcome =
  | "allowed"
  | "blocked"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "budget_exceeded";

export interface AuditEntry {
  category: AuditCategory;
  toolName: string;
  params?: Record<string, unknown>;
  outcome: AuditOutcome;
  reason?: string;
  triggeredRules?: string[];
  consumption?: {
    tokens?: number;
    costUsd?: number;
    durationMs?: number;
  };
}

/**
 * Redact sensitive parameters from tool calls for audit logging.
 */
function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set([
    "password",
    "token",
    "secret",
    "key",
    "apiKey",
    "api_key",
    "authorization",
    "cookie",
    "credentials",
  ]);

  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (sensitiveKeys.has(k.toLowerCase())) {
      redacted[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 200) {
      redacted[k] = v.slice(0, 200) + "...";
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

/**
 * Write an audit entry to the task event log.
 */
export async function writeAuditEntry(
  storePath: string,
  taskId: string,
  entry: AuditEntry,
): Promise<void> {
  const event: TaskEvent = {
    id: randomUUID(),
    taskId,
    type: "audit",
    timestamp: Date.now(),
    message: `[${entry.category}] ${entry.toolName}: ${entry.outcome}${entry.reason ? ` — ${entry.reason}` : ""}`,
    data: {
      category: entry.category,
      toolName: entry.toolName,
      outcome: entry.outcome,
      reason: entry.reason,
      triggeredRules: entry.triggeredRules,
      params: entry.params ? redactParams(entry.params) : undefined,
      consumption: entry.consumption,
    },
  };

  await appendTaskEvent(storePath, event);
}
