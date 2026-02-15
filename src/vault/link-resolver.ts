// ---------------------------------------------------------------------------
// Vault Link Resolver – resolves [[wikilinks]] to note paths
// ---------------------------------------------------------------------------
// Uses Obsidian's shortest-path matching algorithm:
//   1. Exact match (full path)
//   2. Basename match (shortest unique path)
// ---------------------------------------------------------------------------

import * as path from "node:path";
import type {
  VaultBacklink,
  VaultGraph,
  VaultGraphEdge,
  VaultGraphNode,
  VaultLink,
  VaultNoteSummary,
} from "./types.js";

export class LinkResolver {
  /** Map from lowercase basename (without ext) → list of full paths */
  private noteIndex = new Map<string, string[]>();
  /** Set of all known note paths */
  private allPaths = new Set<string>();

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  reindex(paths: string[]): void {
    this.noteIndex.clear();
    this.allPaths.clear();

    for (const p of paths) {
      this.allPaths.add(p);
      const basename = path.basename(p, path.extname(p)).toLowerCase();
      const existing = this.noteIndex.get(basename);
      if (existing) {
        existing.push(p);
      } else {
        this.noteIndex.set(basename, [p]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Resolve a wikilink target to a note path
  // -------------------------------------------------------------------------

  resolve(target: string): string | null {
    // Strip heading anchors (e.g., "Note#Section" → "Note")
    const withoutAnchor = target.split("#")[0]!.trim();
    if (!withoutAnchor) {
      return null;
    }

    // 1. Exact match (target is a full relative path)
    const withExt = withoutAnchor.endsWith(".md") ? withoutAnchor : withoutAnchor + ".md";
    if (this.allPaths.has(withExt)) {
      return withExt;
    }

    // 2. Basename match (shortest path matching)
    const basename = path.basename(withoutAnchor, path.extname(withoutAnchor)).toLowerCase();
    const candidates = this.noteIndex.get(basename);
    if (!candidates || candidates.length === 0) {
      return null;
    }

    // If only one match, return it
    if (candidates.length === 1) {
      return candidates[0]!;
    }

    // If target includes path segments, try to find the best match
    if (withoutAnchor.includes("/")) {
      const normalizedTarget = withExt.toLowerCase();
      for (const c of candidates) {
        if (c.toLowerCase().endsWith(normalizedTarget)) {
          return c;
        }
      }
    }

    // Return shortest path (Obsidian preference)
    return candidates.reduce((shortest, c) => (c.length < shortest.length ? c : shortest));
  }

  // -------------------------------------------------------------------------
  // Backlinks
  // -------------------------------------------------------------------------

  getBacklinks(
    notePath: string,
    allNotes: Array<{ path: string; title: string; links: VaultLink[]; content: string }>,
  ): VaultBacklink[] {
    const backlinks: VaultBacklink[] = [];
    const noteBasename = path.basename(notePath, path.extname(notePath)).toLowerCase();

    for (const note of allNotes) {
      if (note.path === notePath) {
        continue;
      }

      for (const link of note.links) {
        const resolved = this.resolve(link.target);
        if (resolved === notePath) {
          // Extract context around the link
          const lines = note.content.split("\n");
          const contextLine = lines[link.position.line - 1] ?? "";

          backlinks.push({
            sourcePath: note.path,
            sourceTitle: note.title,
            context: contextLine.trim(),
          });
        } else if (!resolved) {
          // Unresolved link — check if basename matches
          const linkBasename = path
            .basename(link.target.split("#")[0]!, path.extname(link.target))
            .toLowerCase();
          if (linkBasename === noteBasename) {
            const lines = note.content.split("\n");
            const contextLine = lines[link.position.line - 1] ?? "";
            backlinks.push({
              sourcePath: note.path,
              sourceTitle: note.title,
              context: contextLine.trim(),
            });
          }
        }
      }
    }

    return backlinks;
  }

  // -------------------------------------------------------------------------
  // Graph
  // -------------------------------------------------------------------------

  buildGraph(notes: VaultNoteSummary[], noteLinks: Map<string, VaultLink[]>): VaultGraph {
    const nodes: VaultGraphNode[] = notes.map((n) => ({
      id: n.path,
      title: n.title,
      path: n.path,
      tags: n.tags,
      linkCount: n.linkCount,
    }));

    const edges: VaultGraphEdge[] = [];
    const seen = new Set<string>();

    for (const note of notes) {
      const links = noteLinks.get(note.path) ?? [];
      for (const link of links) {
        const resolved = this.resolve(link.target);
        if (resolved) {
          const key = `${note.path}->${resolved}`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push({ source: note.path, target: resolved });
          }
        }
      }
    }

    return { nodes, edges };
  }
}
