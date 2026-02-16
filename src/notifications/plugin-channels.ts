// ---------------------------------------------------------------------------
// Plugin Channel Registry – Extensible notification channel delivery
// ---------------------------------------------------------------------------

import type { Notification } from "./types.js";

export type DeliveryResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export type NotificationChannelHandler = (
  notification: Notification,
  config: Record<string, unknown>,
) => Promise<DeliveryResult>;

const registry = new Map<string, NotificationChannelHandler>();

export function registerNotificationChannel(
  name: string,
  handler: NotificationChannelHandler,
): void {
  registry.set(name, handler);
}

export function unregisterNotificationChannel(name: string): boolean {
  return registry.delete(name);
}

export function getNotificationChannel(name: string): NotificationChannelHandler | undefined {
  return registry.get(name);
}

export function listRegisteredChannels(): string[] {
  return Array.from(registry.keys());
}

export function hasNotificationChannel(name: string): boolean {
  return registry.has(name);
}
