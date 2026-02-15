// ---------------------------------------------------------------------------
// Tests for LinkResolver
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import type { VaultLink, VaultNoteSummary } from "./types.js";
import { LinkResolver } from "./link-resolver.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLink(target: string, line = 1, col = 0): VaultLink {
  return { target, position: { line, col } };
}

function makeSummary(p: string, title: string, opts?: Partial<VaultNoteSummary>): VaultNoteSummary {
  return {
    path: p,
    title,
    tags: [],
    linkCount: 0,
    wordCount: 0,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LinkResolver", () => {
  let resolver: LinkResolver;

  beforeEach(() => {
    resolver = new LinkResolver();
  });

  // -----------------------------------------------------------------------
  // resolve()
  // -----------------------------------------------------------------------

  describe("resolve", () => {
    it("returns exact path match with .md extension", () => {
      resolver.reindex(["notes/hello.md", "notes/world.md"]);
      expect(resolver.resolve("notes/hello.md")).toBe("notes/hello.md");
    });

    it("appends .md when target has no extension", () => {
      resolver.reindex(["notes/hello.md"]);
      expect(resolver.resolve("notes/hello")).toBe("notes/hello.md");
    });

    it("resolves by basename when no exact path match", () => {
      resolver.reindex(["folder/deep/note.md"]);
      expect(resolver.resolve("note")).toBe("folder/deep/note.md");
    });

    it("picks the shortest path when basename is ambiguous", () => {
      resolver.reindex(["a/b/c/note.md", "x/note.md", "long/path/to/note.md"]);
      expect(resolver.resolve("note")).toBe("x/note.md");
    });

    it("strips heading anchors before resolving", () => {
      resolver.reindex(["docs/guide.md"]);
      expect(resolver.resolve("guide#Section One")).toBe("docs/guide.md");
    });

    it("returns null for non-existent target", () => {
      resolver.reindex(["notes/hello.md"]);
      expect(resolver.resolve("does-not-exist")).toBeNull();
    });

    it("returns null for empty target after anchor stripping", () => {
      resolver.reindex(["notes/hello.md"]);
      expect(resolver.resolve("#SomeAnchor")).toBeNull();
    });

    it("resolves case-insensitively on basename", () => {
      resolver.reindex(["notes/MyNote.md"]);
      expect(resolver.resolve("mynote")).toBe("notes/MyNote.md");
    });

    it("uses path-qualified target to disambiguate", () => {
      resolver.reindex(["projects/alpha/readme.md", "projects/beta/readme.md"]);
      expect(resolver.resolve("beta/readme")).toBe("projects/beta/readme.md");
    });

    it("returns null when index is empty", () => {
      resolver.reindex([]);
      expect(resolver.resolve("anything")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // reindex()
  // -----------------------------------------------------------------------

  describe("reindex", () => {
    it("rebuilds the index so previously valid targets no longer resolve", () => {
      resolver.reindex(["notes/old.md"]);
      expect(resolver.resolve("old")).toBe("notes/old.md");

      resolver.reindex(["notes/new.md"]);
      expect(resolver.resolve("old")).toBeNull();
      expect(resolver.resolve("new")).toBe("notes/new.md");
    });

    it("handles an empty paths array without error", () => {
      resolver.reindex(["a.md"]);
      resolver.reindex([]);
      expect(resolver.resolve("a")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getBacklinks()
  // -----------------------------------------------------------------------

  describe("getBacklinks", () => {
    it("finds a direct backlink to the target note", () => {
      resolver.reindex(["notes/target.md", "notes/source.md"]);
      const allNotes = [
        {
          path: "notes/source.md",
          title: "Source",
          links: [makeLink("target", 2)],
          content: "Line 1\nSee [[target]] for details\nLine 3",
        },
        {
          path: "notes/target.md",
          title: "Target",
          links: [],
          content: "I am the target",
        },
      ];

      const backlinks = resolver.getBacklinks("notes/target.md", allNotes);
      expect(backlinks).toHaveLength(1);
      expect(backlinks[0]!.sourcePath).toBe("notes/source.md");
      expect(backlinks[0]!.sourceTitle).toBe("Source");
    });

    it("returns the context line from the source note", () => {
      resolver.reindex(["a.md", "b.md"]);
      const allNotes = [
        {
          path: "b.md",
          title: "B",
          links: [makeLink("a", 1)],
          content: "  This links to [[a]] right here  ",
        },
        { path: "a.md", title: "A", links: [], content: "Hello" },
      ];

      const backlinks = resolver.getBacklinks("a.md", allNotes);
      expect(backlinks).toHaveLength(1);
      expect(backlinks[0]!.context).toBe("This links to [[a]] right here");
    });

    it("does not include self-backlinks", () => {
      resolver.reindex(["notes/self.md"]);
      const allNotes = [
        {
          path: "notes/self.md",
          title: "Self",
          links: [makeLink("self", 1)],
          content: "I link to [[self]]",
        },
      ];

      const backlinks = resolver.getBacklinks("notes/self.md", allNotes);
      expect(backlinks).toHaveLength(0);
    });

    it("matches unresolved links by basename fallback", () => {
      // Index does NOT contain the target, but getBacklinks is called
      // with a notePath whose basename matches the unresolved link target.
      resolver.reindex(["notes/source.md"]);
      const allNotes = [
        {
          path: "notes/source.md",
          title: "Source",
          links: [makeLink("orphan-note", 1)],
          content: "Links to [[orphan-note]]",
        },
      ];

      // The note we're looking for backlinks to has a basename "orphan-note"
      const backlinks = resolver.getBacklinks("vault/orphan-note.md", allNotes);
      expect(backlinks).toHaveLength(1);
      expect(backlinks[0]!.sourcePath).toBe("notes/source.md");
    });

    it("returns empty array when no notes link to the target", () => {
      resolver.reindex(["a.md", "b.md"]);
      const allNotes = [
        {
          path: "a.md",
          title: "A",
          links: [makeLink("other", 1)],
          content: "Links to [[other]]",
        },
        { path: "b.md", title: "B", links: [], content: "No links" },
      ];

      const backlinks = resolver.getBacklinks("b.md", allNotes);
      expect(backlinks).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // buildGraph()
  // -----------------------------------------------------------------------

  describe("buildGraph", () => {
    it("builds nodes from note summaries", () => {
      resolver.reindex(["a.md", "b.md"]);
      const notes = [
        makeSummary("a.md", "A", { tags: ["tag1"], linkCount: 1 }),
        makeSummary("b.md", "B", { tags: ["tag2"], linkCount: 0 }),
      ];

      const graph = resolver.buildGraph(notes, new Map());
      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes[0]).toMatchObject({
        id: "a.md",
        title: "A",
        path: "a.md",
        tags: ["tag1"],
        linkCount: 1,
      });
      expect(graph.nodes[1]).toMatchObject({
        id: "b.md",
        title: "B",
        path: "b.md",
        tags: ["tag2"],
        linkCount: 0,
      });
    });

    it("builds edges from resolved links", () => {
      resolver.reindex(["a.md", "b.md"]);
      const notes = [makeSummary("a.md", "A"), makeSummary("b.md", "B")];
      const noteLinks = new Map<string, VaultLink[]>([["a.md", [makeLink("b")]]]);

      const graph = resolver.buildGraph(notes, noteLinks);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({ source: "a.md", target: "b.md" });
    });

    it("deduplicates edges from the same source to the same target", () => {
      resolver.reindex(["a.md", "b.md"]);
      const notes = [makeSummary("a.md", "A"), makeSummary("b.md", "B")];
      const noteLinks = new Map<string, VaultLink[]>([
        ["a.md", [makeLink("b", 1), makeLink("b", 5), makeLink("b", 10)]],
      ]);

      const graph = resolver.buildGraph(notes, noteLinks);
      expect(graph.edges).toHaveLength(1);
    });

    it("handles empty notes and links", () => {
      const graph = resolver.buildGraph([], new Map());
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it("omits edges for unresolvable link targets", () => {
      resolver.reindex(["a.md"]);
      const notes = [makeSummary("a.md", "A")];
      const noteLinks = new Map<string, VaultLink[]>([["a.md", [makeLink("nonexistent")]]]);

      const graph = resolver.buildGraph(notes, noteLinks);
      expect(graph.edges).toHaveLength(0);
    });
  });
});
