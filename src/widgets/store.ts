// ---------------------------------------------------------------------------
// Widget Store – File-based persistence for widget registry, instances,
// and data sources.
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/widgets/
//     registry.json       – { definitions: WidgetDefinition[] }
//     instances.json      – { instances: WidgetInstance[] }
//     data-sources.json   – { sources: DataSource[] }
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WidgetRegistryFile, WidgetInstancesFile, DataSourcesFile } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveWidgetStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "widgets");
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

export async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Empty factory functions (each returns a NEW object to avoid shared-ref bugs)
// ---------------------------------------------------------------------------

export function emptyRegistry(): WidgetRegistryFile {
  return { definitions: [] };
}

export function emptyInstances(): WidgetInstancesFile {
  return { instances: [] };
}

export function emptyDataSources(): DataSourcesFile {
  return { sources: [] };
}

// ---------------------------------------------------------------------------
// Generic atomic write helper
// ---------------------------------------------------------------------------

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + ".tmp";
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Widget Registry – registry.json
// ---------------------------------------------------------------------------

export async function readWidgetRegistry(filePath: string): Promise<WidgetRegistryFile> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as WidgetRegistryFile;
    if (!Array.isArray(parsed.definitions)) {
      return emptyRegistry();
    }
    return parsed;
  } catch {
    return emptyRegistry();
  }
}

export async function writeWidgetRegistry(
  filePath: string,
  data: WidgetRegistryFile,
): Promise<void> {
  await atomicWrite(filePath, data);
}

// ---------------------------------------------------------------------------
// Widget Instances – instances.json
// ---------------------------------------------------------------------------

export async function readWidgetInstances(filePath: string): Promise<WidgetInstancesFile> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as WidgetInstancesFile;
    if (!Array.isArray(parsed.instances)) {
      return emptyInstances();
    }
    return parsed;
  } catch {
    return emptyInstances();
  }
}

export async function writeWidgetInstances(
  filePath: string,
  data: WidgetInstancesFile,
): Promise<void> {
  await atomicWrite(filePath, data);
}

// ---------------------------------------------------------------------------
// Data Sources – data-sources.json
// ---------------------------------------------------------------------------

export async function readDataSources(filePath: string): Promise<DataSourcesFile> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as DataSourcesFile;
    if (!Array.isArray(parsed.sources)) {
      return emptyDataSources();
    }
    return parsed;
  } catch {
    return emptyDataSources();
  }
}

export async function writeDataSources(filePath: string, data: DataSourcesFile): Promise<void> {
  await atomicWrite(filePath, data);
}
