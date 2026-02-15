// ---------------------------------------------------------------------------
// VaultService – Core knowledge base service
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected, event-driven,
// with promise-based locking for safe concurrent writes.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  CanvasData,
  VaultBacklink,
  VaultConfig,
  VaultFilter,
  VaultGraph,
  VaultLink,
  VaultNote,
  VaultNoteCreateInput,
  VaultNotePatch,
  VaultNoteSummary,
  VaultSearchResult,
  VaultTreeNode,
} from "./types.js";
import { LinkResolver } from "./link-resolver.js";
import { extractFrontmatter, parseVaultMetadata, serializeFrontmatter } from "./metadata-parser.js";
import { VaultSearchIndex } from "./search-index.js";
import {
  buildTree,
  deleteNote,
  ensureVaultStructure,
  listNotes,
  moveNote,
  readNote,
  writeNote,
} from "./store.js";
import { createVaultWatcher, type VaultWatcher } from "./watcher.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type VaultServiceDeps = {
  vaultPath: string;
  config: VaultConfig;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type VaultServiceState = {
  deps: VaultServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: VaultServiceDeps): VaultServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as TaskService)
// ---------------------------------------------------------------------------

const vaultLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: VaultServiceState, fn: () => Promise<T>): Promise<T> {
  const vaultPath = state.deps.vaultPath;
  const storeOp = vaultLocks.get(vaultPath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  vaultLocks.set(vaultPath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// VaultService
// ---------------------------------------------------------------------------

export class VaultService {
  private readonly state: VaultServiceState;
  private readonly linkResolver = new LinkResolver();
  private readonly searchIndex = new VaultSearchIndex();
  private watcher: VaultWatcher | null = null;

  /** Cached note content for backlink context */
  private noteContents = new Map<string, { title: string; content: string; links: VaultLink[] }>();

  constructor(deps: VaultServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  get vaultPath(): string {
    return this.state.deps.vaultPath;
  }

  // -------------------------------------------------------------------------
  // init – scan vault, build indexes, start watcher
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    await ensureVaultStructure(this.state.deps.vaultPath);
    await this.rebuildIndexes();

    // Start file watcher
    this.watcher = createVaultWatcher(this.state.deps.vaultPath, {
      onFileChanged: (event) => {
        void this.onFileChanged(event.type, event.relativePath);
      },
    });

    this.state.deps.log.info(`vault initialized at ${this.state.deps.vaultPath}`);
  }

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(filter?: VaultFilter): Promise<VaultNoteSummary[]> {
    let notes = await listNotes(this.state.deps.vaultPath, filter?.folder);

    if (filter?.tags && filter.tags.length > 0) {
      const tagSet = new Set(filter.tags);
      notes = notes.filter((n) => n.tags.some((t) => tagSet.has(t)));
    }

    if (filter?.query) {
      const searchResults = this.searchIndex.search(filter.query);
      const pathSet = new Set(searchResults.map((r) => r.path));
      notes = notes.filter((n) => pathSet.has(n.path));
    }

    if (filter?.limit && filter.limit > 0) {
      notes = notes.slice(0, filter.limit);
    }

    return notes;
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  async get(notePath: string): Promise<VaultNote | null> {
    return readNote(this.state.deps.vaultPath, notePath);
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: VaultNoteCreateInput): Promise<VaultNote> {
    return locked(this.state, async () => {
      let content = input.content ?? "";

      // Apply template if specified
      if (input.templatePath) {
        const template = await readNote(this.state.deps.vaultPath, input.templatePath);
        if (template) {
          content = template.content;
        }
      }

      // Apply frontmatter
      if (input.frontmatter && Object.keys(input.frontmatter).length > 0) {
        const { body } = extractFrontmatter(content);
        content = serializeFrontmatter(input.frontmatter, body);
      }

      await writeNote(this.state.deps.vaultPath, input.path, content);

      // Update indexes
      const metadata = parseVaultMetadata(content);
      this.updateIndexes(input.path, content, metadata);

      const note = await readNote(this.state.deps.vaultPath, input.path);
      if (!note) {
        throw new Error(`Failed to read note after creation: ${input.path}`);
      }

      this.emit("vault.note.created", { path: input.path, title: note.title });
      this.state.deps.log.info(`vault note created: ${input.path}`);

      return note;
    });
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  async update(notePath: string, patch: VaultNotePatch): Promise<VaultNote | null> {
    return locked(this.state, async () => {
      const existing = await readNote(this.state.deps.vaultPath, notePath);
      if (!existing) {
        return null;
      }

      let content = existing.content;

      if (patch.content !== undefined) {
        content = patch.content;
      }

      if (patch.frontmatter !== undefined) {
        const { body } = extractFrontmatter(content);
        content = serializeFrontmatter(patch.frontmatter, body);
      }

      await writeNote(this.state.deps.vaultPath, notePath, content);

      // Update indexes
      const metadata = parseVaultMetadata(content);
      this.updateIndexes(notePath, content, metadata);

      const updated = await readNote(this.state.deps.vaultPath, notePath);
      this.emit("vault.note.updated", { path: notePath, title: updated?.title });
      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(notePath: string): Promise<boolean> {
    return locked(this.state, async () => {
      const ok = await deleteNote(this.state.deps.vaultPath, notePath);
      if (ok) {
        this.searchIndex.removeNote(notePath);
        this.noteContents.delete(notePath);
        this.rebuildLinkIndex();
        this.emit("vault.note.deleted", { path: notePath });
        this.state.deps.log.info(`vault note deleted: ${notePath}`);
      }
      return ok;
    });
  }

  // -------------------------------------------------------------------------
  // move
  // -------------------------------------------------------------------------

  async move(from: string, to: string): Promise<boolean> {
    return locked(this.state, async () => {
      const ok = await moveNote(this.state.deps.vaultPath, from, to);
      if (ok) {
        // Update indexes
        this.searchIndex.removeNote(from);
        this.noteContents.delete(from);

        const note = await readNote(this.state.deps.vaultPath, to);
        if (note) {
          const metadata = parseVaultMetadata(note.content);
          this.updateIndexes(to, note.content, metadata);
        }

        this.emit("vault.note.moved", { from, to });
        this.state.deps.log.info(`vault note moved: ${from} → ${to}`);
      }
      return ok;
    });
  }

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  search(query: string, opts?: { limit?: number }): VaultSearchResult[] {
    return this.searchIndex.search(query, opts);
  }

  // -------------------------------------------------------------------------
  // getBacklinks
  // -------------------------------------------------------------------------

  getBacklinks(notePath: string): VaultBacklink[] {
    const allNotes = Array.from(this.noteContents.entries()).map(([p, data]) => ({
      path: p,
      title: data.title,
      links: data.links,
      content: data.content,
    }));
    return this.linkResolver.getBacklinks(notePath, allNotes);
  }

  // -------------------------------------------------------------------------
  // getGraph
  // -------------------------------------------------------------------------

  async getGraph(): Promise<VaultGraph> {
    const notes = await listNotes(this.state.deps.vaultPath);
    const noteLinks = new Map<string, VaultLink[]>();
    for (const [p, data] of this.noteContents) {
      noteLinks.set(p, data.links);
    }
    return this.linkResolver.buildGraph(notes, noteLinks);
  }

  // -------------------------------------------------------------------------
  // getTags
  // -------------------------------------------------------------------------

  getTags(): string[] {
    const tagSet = new Set<string>();
    for (const data of this.noteContents.values()) {
      const metadata = parseVaultMetadata(data.content);
      for (const tag of metadata.tags) {
        tagSet.add(tag.name);
      }
    }
    return Array.from(tagSet).toSorted();
  }

  // -------------------------------------------------------------------------
  // getTree
  // -------------------------------------------------------------------------

  async getTree(): Promise<VaultTreeNode> {
    return buildTree(this.state.deps.vaultPath);
  }

  // -------------------------------------------------------------------------
  // getDailyNote
  // -------------------------------------------------------------------------

  async getDailyNote(dateStr?: string): Promise<VaultNote> {
    const date = dateStr ?? new Date(this.now()).toISOString().slice(0, 10);
    const format = this.state.deps.config.dailyNoteFormat ?? "YYYY-MM-DD";
    const filename = format
      .replace("YYYY", date.slice(0, 4))
      .replace("MM", date.slice(5, 7))
      .replace("DD", date.slice(8, 10));
    const notePath = `_system/daily/${filename}.md`;

    const existing = await readNote(this.state.deps.vaultPath, notePath);
    if (existing) {
      return existing;
    }

    // Create daily note
    const content = `---\ndate: ${date}\ntags:\n  - daily\n---\n# ${date}\n\n`;
    return this.create({ path: notePath, content });
  }

  // -------------------------------------------------------------------------
  // Canvas operations
  // -------------------------------------------------------------------------

  async getCanvas(canvasPath: string): Promise<CanvasData | null> {
    const fullPath = path.join(this.state.deps.vaultPath, canvasPath);
    try {
      const raw = await fs.readFile(fullPath, "utf-8");
      return JSON.parse(raw) as CanvasData;
    } catch {
      return null;
    }
  }

  async updateCanvas(canvasPath: string, data: CanvasData): Promise<void> {
    return locked(this.state, async () => {
      const fullPath = path.join(this.state.deps.vaultPath, canvasPath);
      const dir = path.dirname(fullPath);
      const { existsSync, mkdirSync } = await import("node:fs");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const tmpPath = fullPath + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.rename(tmpPath, fullPath);
      this.emit("vault.canvas.updated", { path: canvasPath });
    });
  }

  // -------------------------------------------------------------------------
  // getMetadata (parse a single note's metadata)
  // -------------------------------------------------------------------------

  async getMetadata(notePath: string) {
    const note = await readNote(this.state.deps.vaultPath, notePath);
    if (!note) {
      return null;
    }
    return note.metadata;
  }

  // -------------------------------------------------------------------------
  // File change handler (called by watcher)
  // -------------------------------------------------------------------------

  async onFileChanged(type: "add" | "change" | "unlink", relativePath: string): Promise<void> {
    if (type === "unlink") {
      this.searchIndex.removeNote(relativePath);
      this.noteContents.delete(relativePath);
      this.rebuildLinkIndex();
      this.emit("vault.note.deleted", { path: relativePath });
    } else {
      // add or change
      const note = await readNote(this.state.deps.vaultPath, relativePath);
      if (note) {
        const metadata = parseVaultMetadata(note.content);
        this.updateIndexes(relativePath, note.content, metadata);
        const eventType = type === "add" ? "vault.note.created" : "vault.note.updated";
        this.emit(eventType, { path: relativePath, title: note.title });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Index management (private)
  // -------------------------------------------------------------------------

  private async rebuildIndexes(): Promise<void> {
    const summaries = await listNotes(this.state.deps.vaultPath);
    const paths = summaries.map((s) => s.path);
    this.linkResolver.reindex(paths);

    this.noteContents.clear();
    const indexData: Array<{ path: string; title: string; content: string; tags: string[] }> = [];

    for (const summary of summaries) {
      const note = await readNote(this.state.deps.vaultPath, summary.path);
      if (note) {
        this.noteContents.set(summary.path, {
          title: note.title,
          content: note.content,
          links: note.metadata.links,
        });
        indexData.push({
          path: summary.path,
          title: note.title,
          content: note.content,
          tags: note.metadata.tags.map((t) => t.name),
        });
      }
    }

    this.searchIndex.reindex(indexData);
  }

  private updateIndexes(
    notePath: string,
    content: string,
    metadata: ReturnType<typeof parseVaultMetadata>,
  ): void {
    const title =
      metadata.headings.find((h) => h.level === 1)?.text ??
      path.basename(notePath, path.extname(notePath));

    this.noteContents.set(notePath, {
      title,
      content,
      links: metadata.links,
    });

    this.searchIndex.addNote(
      notePath,
      title,
      content,
      metadata.tags.map((t) => t.name),
    );

    this.rebuildLinkIndex();
  }

  private rebuildLinkIndex(): void {
    const paths = Array.from(this.noteContents.keys());
    this.linkResolver.reindex(paths);
  }
}
