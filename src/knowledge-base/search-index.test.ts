import { describe, it, expect, beforeEach } from "vitest";
import { KBSearchIndex } from "./search-index.js";

describe("KBSearchIndex", () => {
  let idx: KBSearchIndex;

  beforeEach(() => {
    idx = new KBSearchIndex();
  });

  // ---------------------------------------------------------------------------
  // addNote + search basics
  // ---------------------------------------------------------------------------

  it("finds a note by title", () => {
    idx.addNote("notes/hello.md", "Hello World", "Some body text.", ["greeting"]);
    const results = idx.search("Hello");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe("notes/hello.md");
    expect(results[0].title).toBe("Hello World");
  });

  it("finds a note by content", () => {
    idx.addNote("notes/recipe.md", "Pancakes", "Mix flour eggs and milk together.", ["cooking"]);
    const results = idx.search("flour");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe("notes/recipe.md");
  });

  it("finds a note by tag", () => {
    idx.addNote("notes/workout.md", "Morning Routine", "Wake up and stretch.", [
      "fitness",
      "health",
    ]);
    const results = idx.search("fitness");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe("notes/workout.md");
  });

  // ---------------------------------------------------------------------------
  // Title boost
  // ---------------------------------------------------------------------------

  it("title match scores higher than content-only match", () => {
    idx.addNote("notes/a.md", "Quantum Physics", "Introduction to the subject.", []);
    idx.addNote("notes/b.md", "General Notes", "This page discusses quantum physics briefly.", []);

    const results = idx.search("quantum");
    expect(results.length).toBe(2);
    // The note with "quantum" in the title should rank first due to 3x boost
    expect(results[0].path).toBe("notes/a.md");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  // ---------------------------------------------------------------------------
  // Fuzzy search
  // ---------------------------------------------------------------------------

  it("finds results with typos via fuzzy matching", () => {
    idx.addNote(
      "notes/architecture.md",
      "Architecture Overview",
      "Describes system architecture.",
      ["design"],
    );
    // "architectre" is a typo for "architecture"
    const results = idx.search("architectre");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe("notes/architecture.md");
  });

  // ---------------------------------------------------------------------------
  // Prefix search
  // ---------------------------------------------------------------------------

  it("finds results with a partial prefix", () => {
    idx.addNote("notes/database.md", "Database Design", "Normalized tables and indexes.", [
      "engineering",
    ]);
    // "datab" is a prefix of "database"
    const results = idx.search("datab");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe("notes/database.md");
  });

  // ---------------------------------------------------------------------------
  // removeNote
  // ---------------------------------------------------------------------------

  it("removes a note so it no longer appears in results", () => {
    idx.addNote("notes/temp.md", "Temporary Note", "This will be removed.", ["temporary"]);
    expect(idx.search("Temporary").length).toBeGreaterThanOrEqual(1);

    idx.removeNote("notes/temp.md");
    expect(idx.search("Temporary")).toEqual([]);
  });

  it("removeNote is a no-op for unknown paths", () => {
    // Should not throw
    idx.removeNote("notes/nonexistent.md");
  });

  // ---------------------------------------------------------------------------
  // addNote twice (update)
  // ---------------------------------------------------------------------------

  it("updates an existing note without creating duplicates", () => {
    idx.addNote("notes/evolving.md", "Draft", "First version of content.", ["draft"]);
    idx.addNote("notes/evolving.md", "Final Version", "Completely rewritten content.", [
      "published",
    ]);

    // Old title should not match
    const oldResults = idx.search("Draft");
    const oldMatching = oldResults.filter((r) => r.path === "notes/evolving.md");
    expect(oldMatching.length).toBe(0);

    // New title should match
    const newResults = idx.search("Final Version");
    expect(newResults.length).toBe(1);
    expect(newResults[0].path).toBe("notes/evolving.md");
    expect(newResults[0].title).toBe("Final Version");
  });

  // ---------------------------------------------------------------------------
  // search with limit
  // ---------------------------------------------------------------------------

  it("respects the limit option", () => {
    for (let i = 0; i < 10; i++) {
      idx.addNote(`notes/note-${i}.md`, `Alpha Note ${i}`, `Alpha content number ${i}.`, ["alpha"]);
    }
    const results = idx.search("alpha", { limit: 3 });
    expect(results.length).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Empty query
  // ---------------------------------------------------------------------------

  it("returns empty array for empty query string", () => {
    idx.addNote("notes/a.md", "Something", "Content here.", []);
    expect(idx.search("")).toEqual([]);
  });

  it("returns empty array for whitespace-only query", () => {
    idx.addNote("notes/a.md", "Something", "Content here.", []);
    expect(idx.search("   ")).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // reindex
  // ---------------------------------------------------------------------------

  it("replaces all notes so old ones are no longer found", () => {
    idx.addNote("notes/old.md", "Old Note", "Legacy content.", ["legacy"]);

    idx.reindex([
      {
        path: "notes/new1.md",
        title: "New Alpha",
        content: "Fresh alpha content.",
        tags: ["fresh"],
      },
      { path: "notes/new2.md", title: "New Beta", content: "Fresh beta content.", tags: ["fresh"] },
    ]);

    // Old note should be gone
    expect(idx.search("Legacy")).toEqual([]);

    // New notes should be findable
    const alphaResults = idx.search("Alpha");
    expect(alphaResults.length).toBe(1);
    expect(alphaResults[0].path).toBe("notes/new1.md");

    const betaResults = idx.search("Beta");
    expect(betaResults.length).toBe(1);
    expect(betaResults[0].path).toBe("notes/new2.md");
  });

  // ---------------------------------------------------------------------------
  // Multiple results sorted by score
  // ---------------------------------------------------------------------------

  it("returns multiple results sorted by score descending", () => {
    idx.addNote(
      "notes/primary.md",
      "Kubernetes Deployment",
      "Deploy applications with Kubernetes.",
      ["kubernetes", "devops"],
    );
    idx.addNote(
      "notes/secondary.md",
      "Docker Basics",
      "Containers can be orchestrated by Kubernetes.",
      ["docker"],
    );
    idx.addNote(
      "notes/tertiary.md",
      "Cloud Overview",
      "Some mention of Kubernetes in passing.",
      [],
    );

    const results = idx.search("kubernetes");
    expect(results.length).toBe(3);

    // Scores should be in descending order
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }

    // The note with "Kubernetes" in title + tags + content should rank highest
    expect(results[0].path).toBe("notes/primary.md");
  });

  // ---------------------------------------------------------------------------
  // Result shape
  // ---------------------------------------------------------------------------

  it("returns results with the correct shape (path, title, score, matches)", () => {
    idx.addNote("notes/shape.md", "Shape Test", "Verifying the result structure.", ["validation"]);
    const results = idx.search("Shape");
    expect(results.length).toBe(1);

    const r = results[0];
    expect(r).toHaveProperty("path", "notes/shape.md");
    expect(r).toHaveProperty("title", "Shape Test");
    expect(typeof r.score).toBe("number");
    expect(r.score).toBeGreaterThan(0);
    expect(Array.isArray(r.matches)).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
    // "matches" contains the search terms that matched
    expect(r.matches).toContain("shape");
  });
});
