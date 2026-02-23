// ---------------------------------------------------------------------------
// heartbeat-active-hours – gate heartbeats to a configured time window
// ---------------------------------------------------------------------------

import { resolveUserTimezone } from "../agents/date-time.js";
import type { OpenClawConfig } from "../config/config.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";

type HeartbeatConfig = AgentDefaultsConfig["heartbeat"];

/**
 * Returns `true` when the current time falls inside the configured
 * `activeHours` window (or when no window is configured at all).
 *
 * `start` / `end` are "HH:MM" strings in 24-hour format.
 * `end` may be "24:00" to mean end-of-day.
 * If `end < start` the window wraps across midnight.
 */
export function isWithinActiveHours(
  cfg: OpenClawConfig,
  heartbeat?: HeartbeatConfig,
  nowMs?: number,
): boolean {
  const active = heartbeat?.activeHours;
  if (!active?.start || !active?.end) {
    // No active-hours configured → always active.
    return true;
  }

  // Resolve timezone: "user" or absent → use the user timezone setting;
  // "local" → host timezone; otherwise treat as IANA id.
  let tz: string;
  const raw = active.timezone?.trim();
  if (!raw || raw === "user") {
    tz = resolveUserTimezone(cfg.agents?.defaults?.userTimezone);
  } else if (raw === "local") {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } else {
    tz = raw;
  }

  // Get current hour and minute in the resolved timezone.
  const now = new Date(nowMs ?? Date.now());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const currentMinutes = hour * 60 + minute;

  const [startH, startM] = active.start.split(":").map(Number) as [number, number];
  const [endH, endM] = active.end.split(":").map(Number) as [number, number];
  const startMinutes = startH * 60 + startM;
  // "24:00" → 1440
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Normal window (e.g. 09:00–17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Wraps midnight (e.g. 22:00–06:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}
