// ---------------------------------------------------------------------------
// KBService – Knowledge Base service layer
// ---------------------------------------------------------------------------
// Follows the VaultService pattern: dependency-injected, event-driven,
// with promise-based locking for safe concurrent writes.
// ---------------------------------------------------------------------------

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
import { resolveKBSyncPath } from "./config.js";
import { parseNoteMetadata, serializeFrontmatter } from "./metadata-parser.js";
import { createProvider, type KBProvider } from "./providers.js";
import { KBSearchIndex } from "./search-index.js";
import { ensureKBStructure, listNotes, readNote, writeNote } from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type KBServiceDeps = {
  config: KBConfig;
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

type KBServiceState = {
  deps: KBServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: KBServiceDeps): KBServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as VaultService / TaskService)
// ---------------------------------------------------------------------------

const kbLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: KBServiceState, fn: () => Promise<T>): Promise<T> {
  const key = state.deps.config.vaultPath;
  const storeOp = kbLocks.get(key) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  kbLocks.set(key, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// KBService
// ---------------------------------------------------------------------------

export class KBService {
  private readonly state: KBServiceState;
  private readonly searchIndex = new KBSearchIndex();
  private readonly provider: KBProvider;

  /** Cached note content for tag extraction */
  private noteContents = new Map<string, { title: string; content: string; tags: string[] }>();

  constructor(deps: KBServiceDeps) {
    this.state = createServiceState(deps);
    this.provider = createProvider(deps.config);
  }

  private get kbPath(): string {
    return resolveKBSyncPath(this.state.deps.config);
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // -------------------------------------------------------------------------
  // init – ensure KB structure, rebuild search index
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const syncFolder = this.state.deps.config.syncFolder;
    await ensureKBStructure(this.state.deps.config.vaultPath, syncFolder);
    await this.rebuildIndex();
    this.state.deps.log.info(`kb initialized at ${this.kbPath}`);
  }

  // -------------------------------------------------------------------------
  // close – no-op (no watcher in KB adapter)
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    // No watcher to tear down
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(filter?: KBFilter): Promise<KBNoteSummary[]> {
    let notes = await listNotes(this.kbPath, filter?.folder);

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

  async get(notePath: string): Promise<KBNote | null> {
    return readNote(this.kbPath, notePath);
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: KBNoteCreateInput): Promise<KBNote> {
    return locked(this.state, async () => {
      let content = input.content ?? "";

      // Apply frontmatter if provided
      if (input.frontmatter && Object.keys(input.frontmatter).length > 0) {
        content = serializeFrontmatter(input.frontmatter, content);
      }

      await writeNote(this.kbPath, input.path, content);

      // Update indexes
      const metadata = parseNoteMetadata(content);
      const title =
        metadata.headings.find((h) => h.level === 1)?.text ??
        path.basename(input.path, path.extname(input.path));

      this.noteContents.set(input.path, {
        title,
        content,
        tags: metadata.tags.map((t) => t.name),
      });

      this.searchIndex.addNote(
        input.path,
        title,
        content,
        metadata.tags.map((t) => t.name),
      );

      const note = await readNote(this.kbPath, input.path);
      if (!note) {
        throw new Error(`Failed to read note after creation: ${input.path}`);
      }

      this.emit("kb.note.created", { path: input.path, title: note.title });
      this.state.deps.log.info(`kb note created: ${input.path}`);

      return note;
    });
  }

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  search(query: string, opts?: { limit?: number }): KBSearchResult[] {
    return this.searchIndex.search(query, opts);
  }

  // -------------------------------------------------------------------------
  // getTags
  // -------------------------------------------------------------------------

  getTags(): string[] {
    const tagSet = new Set<string>();
    for (const data of this.noteContents.values()) {
      for (const tag of data.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).toSorted();
  }

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  status(): KBStatus {
    return {
      configured: this.state.deps.config.enabled,
      provider: this.state.deps.config.provider ?? null,
      vaultPath: this.state.deps.config.vaultPath || null,
      noteCount: this.noteContents.size,
    };
  }

  // -------------------------------------------------------------------------
  // URI helpers (delegate to provider)
  // -------------------------------------------------------------------------

  openURI(): string {
    return this.provider.openVault();
  }

  openNoteURI(notePath: string): string {
    return this.provider.openNote(notePath);
  }

  searchURI(query: string): string {
    return this.provider.search(query);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getVaultPath(): string {
    return this.kbPath;
  }

  getConfig(): KBConfig {
    return { ...this.state.deps.config };
  }

  // -------------------------------------------------------------------------
  // Index management (private)
  // -------------------------------------------------------------------------

  private async rebuildIndex(): Promise<void> {
    const summaries = await listNotes(this.kbPath);

    this.noteContents.clear();
    const indexData: Array<{ path: string; title: string; content: string; tags: string[] }> = [];

    for (const summary of summaries) {
      const note = await readNote(this.kbPath, summary.path);
      if (note) {
        const tags = note.metadata.tags.map((t) => t.name);
        this.noteContents.set(summary.path, {
          title: note.title,
          content: note.content,
          tags,
        });
        indexData.push({
          path: summary.path,
          title: note.title,
          content: note.content,
          tags,
        });
      }
    }

    this.searchIndex.reindex(indexData);
  }
}
