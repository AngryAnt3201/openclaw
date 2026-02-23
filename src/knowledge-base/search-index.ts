// ---------------------------------------------------------------------------
// KB Search Index – full-text search backed by MiniSearch
// ---------------------------------------------------------------------------

import MiniSearch from "minisearch";
import type { KBSearchResult } from "./types.js";

type IndexedNote = {
  id: string;
  title: string;
  content: string;
  tags: string;
};

export class KBSearchIndex {
  private index: MiniSearch<IndexedNote>;

  constructor() {
    this.index = new MiniSearch<IndexedNote>({
      fields: ["title", "content", "tags"],
      storeFields: ["title"],
      searchOptions: {
        boost: { title: 3, tags: 2, content: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Add / remove / update
  // -------------------------------------------------------------------------

  addNote(notePath: string, title: string, content: string, tags: string[]): void {
    // Remove if already exists
    if (this.index.has(notePath)) {
      this.index.discard(notePath);
    }
    this.index.add({
      id: notePath,
      title,
      content,
      tags: tags.join(" "),
    });
  }

  removeNote(notePath: string): void {
    if (this.index.has(notePath)) {
      this.index.discard(notePath);
    }
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  search(query: string, opts?: { limit?: number }): KBSearchResult[] {
    if (!query.trim()) {
      return [];
    }

    const results = this.index.search(query);
    const limited = opts?.limit ? results.slice(0, opts.limit) : results;

    return limited.map((r) => ({
      path: r.id,
      title: (r as unknown as { title: string }).title,
      score: r.score,
      matches: Object.keys(r.match),
    }));
  }

  // -------------------------------------------------------------------------
  // Rebuild from scratch
  // -------------------------------------------------------------------------

  reindex(notes: Array<{ path: string; title: string; content: string; tags: string[] }>): void {
    this.index.removeAll();
    for (const note of notes) {
      this.index.add({
        id: note.path,
        title: note.title,
        content: note.content,
        tags: note.tags.join(" "),
      });
    }
  }
}
