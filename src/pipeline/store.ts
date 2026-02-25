// ---------------------------------------------------------------------------
// Pipeline Store – File-based persistence following task store pattern
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/pipelines/
//     store.json              – { version: 1, pipelines: Pipeline[] }
//     events/{pipeline-id}.jsonl – Append-only event log per pipeline
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PipelineStoreFile, PipelineEvent, PipelineNode } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolvePipelineStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "pipelines", "store.json");
}

export function resolvePipelineEventsDir(storePath: string): string {
  return path.join(path.dirname(storePath), "events");
}

export function resolvePipelineEventLogPath(storePath: string, pipelineId: string): string {
  return path.join(resolvePipelineEventsDir(storePath), `${pipelineId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

let writeSeq = 0;

function emptyStore(): PipelineStoreFile {
  return { version: 1, pipelines: [] };
}

/** Normalize a node from legacy format (strip kind, fill defaults). */
function normalizeLegacyNode(node: PipelineNode): PipelineNode {
  const config = { ...(node.config as Record<string, unknown>) };
  delete config.kind;
  return {
    ...node,
    label: node.label ?? (node.type as string) ?? "Untitled",
    position: node.position ?? { x: 0, y: 0 },
    config: config as PipelineNode["config"],
    state: node.state ?? { status: "idle" as const, retryCount: 0 },
  };
}

export async function loadPipelineStore(storePath: string): Promise<PipelineStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as PipelineStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.pipelines)) {
      return emptyStore();
    }
    // Normalize legacy data on load
    for (const pipeline of parsed.pipelines) {
      pipeline.nodes = (pipeline.nodes ?? []).map(normalizeLegacyNode);
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function savePipelineStore(
  storePath: string,
  store: PipelineStoreFile,
): Promise<void> {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmp = storePath + ".tmp." + process.pid + "." + writeSeq++;
  const content = JSON.stringify(store, null, 2);
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, storePath);
}

// ---------------------------------------------------------------------------
// Event log (append-only JSONL)
// ---------------------------------------------------------------------------

export async function appendPipelineEvent(storePath: string, event: PipelineEvent): Promise<void> {
  const eventsDir = resolvePipelineEventsDir(storePath);
  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
  }
  const logPath = resolvePipelineEventLogPath(storePath, event.pipelineId);
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(logPath, line, "utf-8");
}

export async function readPipelineEvents(
  storePath: string,
  pipelineId: string,
  opts?: { limit?: number },
): Promise<PipelineEvent[]> {
  const logPath = resolvePipelineEventLogPath(storePath, pipelineId);
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const events: PipelineEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as PipelineEvent);
      } catch {
        // Skip malformed lines
      }
    }
    if (opts?.limit && opts.limit > 0) {
      return events.slice(-opts.limit);
    }
    return events;
  } catch {
    return [];
  }
}
