// ---------------------------------------------------------------------------
// Knowledge Base Service – provides CRUD operations over the KB store
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  KBConfig,
  KBFilter,
  KBNote,
  KBNoteCreateInput,
  KBNoteSummary,
  KBSearchResult,
  KBStatus,
} from "./types.js";
import { resolveKBPath, listNotes } from "./store.js";

export type KBServiceOptions = {
  config: KBConfig;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast?: (event: string, payload: unknown) => void;
};

export class KBService {
  readonly kbPath: string;
  readonly config: KBConfig;
  private log: NonNullable<KBServiceOptions["log"]>;
  private broadcast: (event: string, payload: unknown) => void;

  constructor(opts: KBServiceOptions) {
    this.config = opts.config;
    this.kbPath = opts.config.vaultPath
      ? resolveKBPath(opts.config.vaultPath)
      : resolveKBPath();
    this.log = opts.log ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.broadcast = opts.broadcast ?? (() => {});
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(this.kbPath, { recursive: true });
      this.log.info(`KB service initialized at ${this.kbPath}`);
    } catch (err) {
      this.log.warn(`KB init: could not ensure directory: ${String(err)}`);
    }
  }

  async close(): Promise<void> {
    // No-op for now; reserved for watcher cleanup
  }

  async list(filter?: KBFilter): Promise<KBNoteSummary[]> {
    return listNotes(this.kbPath, filter?.folder);
  }

  async get(notePath: string): Promise<KBNote | null> {
    const fullPath = path.join(this.kbPath, notePath);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const stat = await fs.stat(fullPath);
      return {
        path: notePath,
        title: path.basename(notePath, path.extname(notePath)),
        content,
        metadata: {
          frontmatter: {},
          headings: [],
          links: [],
          tags: [],
          wordCount: content.split(/\s+/).length,
        },
        createdAtMs: stat.birthtimeMs,
        updatedAtMs: stat.mtimeMs,
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  }

  async create(input: KBNoteCreateInput): Promise<KBNote> {
    const fullPath = path.join(this.kbPath, input.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    let content = "";
    if (input.frontmatter && Object.keys(input.frontmatter).length > 0) {
      const yamlLines = Object.entries(input.frontmatter).map(
        ([k, v]) => `${k}: ${JSON.stringify(v)}`,
      );
      content = `---\n${yamlLines.join("\n")}\n---\n\n`;
    }
    content += input.content ?? "";

    await fs.writeFile(fullPath, content, "utf-8");
    const stat = await fs.stat(fullPath);

    const note: KBNote = {
      path: input.path,
      title: path.basename(input.path, path.extname(input.path)),
      content,
      metadata: {
        frontmatter: input.frontmatter ?? {},
        headings: [],
        links: [],
        tags: [],
        wordCount: content.split(/\s+/).length,
      },
      createdAtMs: stat.birthtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: stat.size,
    };

    this.broadcast("kb.note.created", { path: input.path });
    return note;
  }

  async search(query: string, opts?: { limit?: number }): Promise<KBSearchResult[]> {
    const limit = opts?.limit ?? 20;
    const notes = await listNotes(this.kbPath);
    const results: KBSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const note of notes) {
      if (results.length >= limit) break;
      if (
        note.title.toLowerCase().includes(lowerQuery) ||
        note.tags.some((t) => t.toLowerCase().includes(lowerQuery))
      ) {
        results.push({
          path: note.path,
          title: note.title,
          score: 1.0,
          matches: [note.title],
        });
      }
    }

    return results;
  }

  getTags(): string[] {
    // Stub: full implementation will scan all notes
    return [];
  }

  async getStatus(): Promise<KBStatus> {
    const notes = await listNotes(this.kbPath);
    return {
      configured: this.config.enabled,
      provider: this.config.provider,
      vaultPath: this.kbPath,
      noteCount: notes.length,
    };
  }

  async openKB(): Promise<{ opened: boolean }> {
    // Delegate to OS-level open via the configured openCommand
    if (this.config.openCommand) {
      const { exec } = await import("node:child_process");
      exec(this.config.openCommand);
      return { opened: true };
    }
    return { opened: false };
  }

  async openNote(notePath: string): Promise<{ opened: boolean }> {
    const fullPath = path.join(this.kbPath, notePath);
    try {
      await fs.access(fullPath);
      const { exec } = await import("node:child_process");
      exec(`open "${fullPath}"`);
      return { opened: true };
    } catch {
      return { opened: false };
    }
  }

  async getConfig(): Promise<KBConfig> {
    return this.config;
  }
}
