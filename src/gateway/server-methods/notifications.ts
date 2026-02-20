// ---------------------------------------------------------------------------
// Gateway RPC handlers for notification.* methods – follows tasks.ts pattern
// ---------------------------------------------------------------------------

import type {
  NotificationCreateInput,
  NotificationFilter,
  NotificationPreferences,
} from "../../notifications/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const notificationHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // notification.list
  // -------------------------------------------------------------------------
  "notification.list": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const filter = (params ?? {}) as NotificationFilter;
    const notifications = await context.notificationService.list(filter);
    respond(true, { notifications }, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.get
  // -------------------------------------------------------------------------
  "notification.get": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const notification = await context.notificationService.get(id);
    if (!notification) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `notification not found: ${id}`),
      );
      return;
    }
    respond(true, notification, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.create
  // -------------------------------------------------------------------------
  "notification.create": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const input = params as NotificationCreateInput;
    if (!input.title || typeof input.title !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing title"));
      return;
    }
    if (!input.body || typeof input.body !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing body"));
      return;
    }
    if (!input.type || typeof input.type !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing type"));
      return;
    }
    const notification = await context.notificationService.create(input);
    respond(true, notification, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.markRead
  // -------------------------------------------------------------------------
  "notification.markRead": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const notification = await context.notificationService.markRead(id);
    if (!notification) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `notification not found: ${id}`),
      );
      return;
    }
    respond(true, notification, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.markAllRead
  // -------------------------------------------------------------------------
  "notification.markAllRead": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const count = await context.notificationService.markAllRead();
    respond(true, { count }, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.dismiss
  // -------------------------------------------------------------------------
  "notification.dismiss": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const notification = await context.notificationService.dismiss(id);
    if (!notification) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `notification not found: ${id}`),
      );
      return;
    }
    respond(true, notification, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.dismissAll
  // -------------------------------------------------------------------------
  "notification.dismissAll": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const count = await context.notificationService.dismissAll();
    respond(true, { count }, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.unreadCount
  // -------------------------------------------------------------------------
  "notification.unreadCount": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const count = await context.notificationService.getUnreadCount();
    respond(true, { count }, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.preferences.get
  // -------------------------------------------------------------------------
  "notification.preferences.get": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const preferences = await context.notificationService.getPreferences();
    respond(true, preferences, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.preferences.set
  // -------------------------------------------------------------------------
  "notification.preferences.set": async ({ params, respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const patch = params as Partial<NotificationPreferences>;
    const preferences = await context.notificationService.updatePreferences(patch);
    respond(true, preferences, undefined);
  },

  // -------------------------------------------------------------------------
  // notification.channels.list
  // -------------------------------------------------------------------------
  "notification.channels.list": async ({ respond, context }) => {
    if (!context.notificationService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "notifications not enabled"),
      );
      return;
    }
    const preferences = await context.notificationService.getPreferences();
    const channels = preferences.defaultChannels ?? [];
    respond(true, { channels }, undefined);
  },
};
