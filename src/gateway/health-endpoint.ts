import type { IncomingMessage, ServerResponse } from "node:http";
import { memoryUsage, uptime } from "node:process";

export interface HealthStatus {
  status: "ok" | "degraded";
  uptime: number;
  memoryMB: number;
  connections: number;
  lastTickTs: number;
  version: string;
}

let connectionCount = 0;
let lastTickTs = Date.now();
let gatewayVersion = "unknown";

export function setHealthConnectionCount(count: number): void {
  connectionCount = count;
}

export function setHealthLastTick(ts: number): void {
  lastTickTs = ts;
}

export function setHealthGatewayVersion(version: string): void {
  gatewayVersion = version;
}

export function getHealthStatus(): HealthStatus {
  const mem = memoryUsage();
  const tickAge = Date.now() - lastTickTs;
  return {
    status: tickAge > 90_000 ? "degraded" : "ok",
    uptime: Math.round(uptime()),
    memoryMB: Math.round(mem.rss / 1024 / 1024),
    connections: connectionCount,
    lastTickTs,
    version: gatewayVersion,
  };
}

export function handleHealthRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/health") {
    return false;
  }

  const health = getHealthStatus();
  res.statusCode = health.status === "ok" ? 200 : 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(JSON.stringify(health));
  return true;
}
