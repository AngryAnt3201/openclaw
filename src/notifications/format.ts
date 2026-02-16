// ---------------------------------------------------------------------------
// Notification Formatter – Per-channel message formatting
// ---------------------------------------------------------------------------

import type { Notification } from "./types.js";

export type FormattedNotification = {
  text: string;
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

export function formatForDiscord(n: Notification): FormattedNotification {
  const priority = PRIORITY_LABELS[n.priority] ?? n.priority;
  const text = `**[${priority}] ${n.title}**\n${n.body}`;
  return { text };
}

export function formatForTelegram(n: Notification): FormattedNotification {
  const priority = PRIORITY_LABELS[n.priority] ?? n.priority;
  const text = `<b>[${priority}] ${n.title}</b>\n${n.body}`;
  return { text };
}

export function formatForWhatsApp(n: Notification): FormattedNotification {
  const priority = PRIORITY_LABELS[n.priority] ?? n.priority;
  const text = `*[${priority}] ${n.title}*\n${n.body}`;
  return { text };
}

export function formatForSlack(n: Notification): FormattedNotification {
  const priority = PRIORITY_LABELS[n.priority] ?? n.priority;
  const text = `*[${priority}] ${n.title}*\n${n.body}`;
  return { text };
}

export function formatForWebhook(n: Notification): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    priority: n.priority,
    taskId: n.taskId,
    agentId: n.agentId,
    source: n.source,
    createdAtMs: n.createdAtMs,
    data: n.data,
  };
}

export function formatForChannel(channel: string, n: Notification): FormattedNotification {
  switch (channel) {
    case "discord":
      return formatForDiscord(n);
    case "telegram":
      return formatForTelegram(n);
    case "whatsapp":
      return formatForWhatsApp(n);
    case "slack":
      return formatForSlack(n);
    default:
      return formatForDiscord(n);
  }
}
