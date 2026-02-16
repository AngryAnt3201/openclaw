// ---------------------------------------------------------------------------
// Notification Dispatch – Channel delivery engine
// ---------------------------------------------------------------------------
// Dispatches notifications to external channels via the existing
// deliverOutboundPayloads infrastructure and plugin channel handlers.
// ---------------------------------------------------------------------------

import type { OpenClawConfig } from "../config/config.js";
import type { OutboundSendDeps } from "../infra/outbound/deliver.js";
import type { Notification, NotificationPreferences, QuietHours, WebhookConfig } from "./types.js";
import { formatForChannel, formatForWebhook } from "./format.js";
import { getNotificationChannel, hasNotificationChannel } from "./plugin-channels.js";

// ---------------------------------------------------------------------------
// Dependencies (injected)
// ---------------------------------------------------------------------------

export type NodeInvoker = {
  listConnectedNodes: () => Array<{ nodeId: string; commands: string[]; platform?: string }>;
  invoke: (params: {
    nodeId: string;
    command: string;
    params?: unknown;
    timeoutMs?: number;
    idempotencyKey: string;
  }) => Promise<{ ok: boolean; error?: { code?: string; message?: string } | null }>;
};

export type DispatchDeps = {
  cfg: OpenClawConfig;
  channelTargets: Record<string, string>;
  sendDeps?: OutboundSendDeps;
  deliverOutbound?: (params: {
    cfg: OpenClawConfig;
    channel: string;
    to: string;
    payloads: Array<{ text: string }>;
    deps?: OutboundSendDeps;
    bestEffort?: boolean;
  }) => Promise<unknown[]>;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  nodeInvoker?: NodeInvoker;
};

// ---------------------------------------------------------------------------
// Quiet hours check
// ---------------------------------------------------------------------------

export function isInQuietHours(quietHours: QuietHours, nowMs?: number): boolean {
  if (!quietHours.enabled) {
    return false;
  }

  const now = new Date(nowMs ?? Date.now());
  const hour = now.getHours();
  const { startHour, endHour } = quietHours;

  if (startHour <= endHour) {
    // e.g., 8am-6pm: quiet inside range
    return hour >= startHour && hour < endHour;
  }
  // e.g., 10pm-8am: quiet outside the non-quiet window
  return hour >= startHour || hour < endHour;
}

// ---------------------------------------------------------------------------
// Channel resolution
// ---------------------------------------------------------------------------

const NATIVE_CHANNELS = new Set([
  "discord",
  "telegram",
  "whatsapp",
  "slack",
  "signal",
  "imessage",
  "matrix",
]);

export function resolveChannels(
  notification: Notification,
  preferences: NotificationPreferences,
  requestedChannels?: string[],
): string[] {
  if (!preferences.enabled) {
    return [];
  }

  // Use explicit channels if provided
  if (requestedChannels && requestedChannels.length > 0) {
    return requestedChannels;
  }

  // Check per-type route config
  const route = preferences.routes[notification.type];
  if (route) {
    if (!route.enabled) {
      return [];
    }
    if (route.minPriority) {
      const priorityOrder = ["low", "medium", "high", "critical"];
      const notifLevel = priorityOrder.indexOf(notification.priority);
      const minLevel = priorityOrder.indexOf(route.minPriority);
      if (notifLevel < minLevel) {
        return [];
      }
    }
    return route.channels;
  }

  // Fall back to default channels
  return preferences.defaultChannels;
}

// ---------------------------------------------------------------------------
// Dispatch to a single channel
// ---------------------------------------------------------------------------

type ChannelResult = {
  channel: string;
  success: boolean;
  error?: string;
};

async function dispatchToNativeChannel(
  deps: DispatchDeps,
  channel: string,
  notification: Notification,
): Promise<ChannelResult> {
  const to = deps.channelTargets[channel];
  if (!to) {
    return { channel, success: false, error: `no target configured for ${channel}` };
  }

  if (!deps.deliverOutbound) {
    return { channel, success: false, error: "deliverOutbound not available" };
  }

  const formatted = formatForChannel(channel, notification);
  try {
    await deps.deliverOutbound({
      cfg: deps.cfg,
      channel,
      to,
      payloads: [{ text: formatted.text }],
      deps: deps.sendDeps,
      bestEffort: true,
    });
    return { channel, success: true };
  } catch (err) {
    return { channel, success: false, error: String(err) };
  }
}

async function dispatchToWebhook(
  webhook: WebhookConfig,
  notification: Notification,
): Promise<ChannelResult> {
  if (!webhook.enabled) {
    return { channel: "webhook", success: false, error: "webhook disabled" };
  }

  const payload = formatForWebhook(notification);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (webhook.secret) {
      headers["X-Webhook-Secret"] = webhook.secret;
    }

    const resp = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return { channel: "webhook", success: false, error: `HTTP ${resp.status}` };
    }
    return { channel: "webhook", success: true };
  } catch (err) {
    return { channel: "webhook", success: false, error: String(err) };
  }
}

async function dispatchToPluginChannel(
  channel: string,
  notification: Notification,
  config: Record<string, unknown>,
): Promise<ChannelResult> {
  const handler = getNotificationChannel(channel);
  if (!handler) {
    return { channel, success: false, error: `plugin channel not registered: ${channel}` };
  }

  try {
    const result = await handler(notification, config);
    return { channel, success: result.success, error: result.error };
  } catch (err) {
    return { channel, success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Node push dispatch
// ---------------------------------------------------------------------------

const NODE_PRIORITY_MAP: Record<string, string> = {
  critical: "timeSensitive",
  high: "active",
  medium: "active",
  low: "passive",
};

async function dispatchToNodes(
  deps: DispatchDeps,
  notification: Notification,
): Promise<ChannelResult[]> {
  if (!deps.nodeInvoker) {
    return [];
  }

  const nodes = deps.nodeInvoker
    .listConnectedNodes()
    .filter((n) => n.commands.includes("system.notify"));

  if (nodes.length === 0) {
    return [];
  }

  const results: ChannelResult[] = [];
  for (const node of nodes) {
    try {
      const res = await deps.nodeInvoker.invoke({
        nodeId: node.nodeId,
        command: "system.notify",
        params: {
          title: notification.title,
          body: notification.body,
          priority: NODE_PRIORITY_MAP[notification.priority] ?? "active",
          delivery: "system",
        },
        timeoutMs: 10_000,
        idempotencyKey: `notif-${notification.id}-${node.nodeId}`,
      });
      results.push({
        channel: `node:${node.nodeId}`,
        success: res.ok,
        error: res.ok ? undefined : (res.error?.message ?? "invoke failed"),
      });
    } catch (err) {
      results.push({
        channel: `node:${node.nodeId}`,
        success: false,
        error: String(err),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main dispatch function
// ---------------------------------------------------------------------------

export async function dispatchNotification(
  deps: DispatchDeps,
  notification: Notification,
  channels: string[],
  preferences: NotificationPreferences,
): Promise<ChannelResult[]> {
  // Check quiet hours for external dispatch
  if (isInQuietHours(preferences.quietHours) && notification.priority !== "critical") {
    deps.log.info(`notification ${notification.id} suppressed by quiet hours`);
    return [];
  }

  const results: ChannelResult[] = [];

  for (const channel of channels) {
    if (NATIVE_CHANNELS.has(channel)) {
      const result = await dispatchToNativeChannel(deps, channel, notification);
      results.push(result);
      if (!result.success) {
        deps.log.warn(`dispatch to ${channel} failed: ${result.error}`);
      }
    } else if (hasNotificationChannel(channel)) {
      const config = deps.channelTargets[channel] ? { target: deps.channelTargets[channel] } : {};
      const result = await dispatchToPluginChannel(channel, notification, config);
      results.push(result);
      if (!result.success) {
        deps.log.warn(`dispatch to plugin channel ${channel} failed: ${result.error}`);
      }
    }
  }

  // Also dispatch to any configured webhooks
  for (const webhook of preferences.webhooks) {
    const result = await dispatchToWebhook(webhook, notification);
    results.push(result);
    if (!result.success) {
      deps.log.warn(`dispatch to webhook ${webhook.url} failed: ${result.error}`);
    }
  }

  // Push to connected nodes
  if (preferences.nodePushEnabled !== false) {
    const nodeResults = await dispatchToNodes(deps, notification);
    results.push(...nodeResults);
  }

  return results;
}
