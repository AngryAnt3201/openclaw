// ---------------------------------------------------------------------------
// Built-in widget definitions (gateway-side)
// ---------------------------------------------------------------------------
// These 20 system-provided widget blueprints are seeded into the registry
// on gateway startup if not already present. They mirror the frontend
// BUILTIN_WIDGET_DEFINITIONS in src/lib/widget-defaults.ts.
// ---------------------------------------------------------------------------

import type { WidgetDefinition, WidgetType, WidgetCategory } from "./types.js";
import { DEFAULT_WIDGET_SIZES } from "./types.js";

/** Epoch timestamp used for all built-in definitions (2026-01-01T00:00:00Z). */
const BUILTIN_EPOCH = Date.UTC(2026, 0, 1); // 1767225600000

function systemDef(
  type: WidgetType,
  name: string,
  category: WidgetCategory,
  opts?: Partial<WidgetDefinition>,
): WidgetDefinition {
  return {
    id: `builtin-${type}`,
    type,
    name,
    category,
    size: DEFAULT_WIDGET_SIZES[type],
    createdBy: "system",
    createdAt: BUILTIN_EPOCH,
    persistent: true,
    ...opts,
  };
}

export const BUILTIN_WIDGET_DEFINITIONS: WidgetDefinition[] = [
  // -- System --
  systemDef("tasks", "Tasks", "system", {
    dataSource: { type: "store", storeKey: "tasks" },
  }),
  systemDef("notifications", "Notifications", "system", {
    dataSource: { type: "store", storeKey: "notifications" },
  }),
  systemDef("sessions", "Sessions", "system", {
    dataSource: { type: "store", storeKey: "sessions" },
  }),
  systemDef("credentials", "Credentials", "system", {
    dataSource: { type: "store", storeKey: "credentials" },
  }),
  systemDef("system-monitor", "System Monitor", "system"),
  systemDef("network-status", "Network Status", "system"),
  systemDef("gateway-status", "Gateway Status", "system"),

  // -- Agent --
  systemDef("agent-activity", "Agent Activity", "agent"),
  systemDef("chat-log", "Chat Log", "agent"),
  systemDef("tool-usage", "Tool Usage", "agent"),

  // -- Data --
  systemDef("analytics", "Analytics", "data"),
  systemDef("trend", "Trend", "data"),
  systemDef("database-viewer", "Database Viewer", "data"),

  // -- Productivity --
  systemDef("calendar", "Calendar", "productivity"),
  systemDef("weather", "Weather", "productivity"),
  systemDef("clock", "Clock", "productivity"),
  systemDef("quick-notes", "Quick Notes", "productivity"),

  // -- Media --
  systemDef("file-browser", "File Browser", "media"),
  systemDef("image-viewer", "Image Viewer", "media"),

  // -- Meta --
  systemDef("status-card", "Status Card", "system"),
];
