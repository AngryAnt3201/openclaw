import { describe, it, expect } from "vitest";
import {
  extractFrontmatter,
  serializeFrontmatter,
  extractWikilinks,
  extractTags,
  extractHeadings,
  parseVaultMetadata,
} from "./metadata-parser.js";

// ---------------------------------------------------------------------------
// 1. Frontmatter
// ---------------------------------------------------------------------------

describe("extractFrontmatter", () => {
  it("parses valid YAML frontmatter", () => {
    const content = `---\ntitle: Hello World\ndate: 2026-01-15\n---\nBody text here.`;
    const result = extractFrontmatter(content);
    expect(result.frontmatter).toEqual({
      title: "Hello World",
      date: "2026-01-15",
    });
    expect(result.body).toBe("Body text here.");
  });

  it("returns empty frontmatter and full body when no frontmatter present", () => {
    const content = "Just a plain markdown document.";
    const result = extractFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  it("handles empty frontmatter block", () => {
    const content = `---\n\n---\nBody after empty frontmatter.`;
    const result = extractFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body after empty frontmatter.");
  });

  it("handles malformed YAML gracefully by returning empty frontmatter", () => {
    const content = `---\n: invalid: [yaml:: broken\n---\nBody text.`;
    const result = extractFrontmatter(content);
    // Malformed YAML should fall back to empty frontmatter
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  it("parses nested objects in frontmatter", () => {
    const content = `---\ntitle: Nested Test\nauthor:\n  name: Alice\n  email: alice@example.com\ntags:\n  - one\n  - two\n---\nBody.`;
    const result = extractFrontmatter(content);
    expect(result.frontmatter.title).toBe("Nested Test");
    expect(result.frontmatter.author).toEqual({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result.frontmatter.tags).toEqual(["one", "two"]);
    expect(result.body).toBe("Body.");
  });
});

// ---------------------------------------------------------------------------
// 2. serializeFrontmatter
// ---------------------------------------------------------------------------

describe("serializeFrontmatter", () => {
  it("returns just the body when frontmatter is empty", () => {
    const result = serializeFrontmatter({}, "Hello world.");
    expect(result).toBe("Hello world.");
  });

  it("wraps non-empty frontmatter with --- delimiters", () => {
    const result = serializeFrontmatter({ title: "Test" }, "Body here.");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("title: Test");
    expect(result).toMatch(/\n---\nBody here\.$/);
  });

  it("round-trips with extractFrontmatter", () => {
    const original = { title: "Round Trip", status: "draft" };
    const body = "Some content here.";
    const serialized = serializeFrontmatter(original, body);
    const parsed = extractFrontmatter(serialized);
    expect(parsed.frontmatter).toEqual(original);
    expect(parsed.body).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// 3. Wikilinks
// ---------------------------------------------------------------------------

describe("extractWikilinks", () => {
  it("extracts a basic [[target]] link", () => {
    const content = "See [[My Note]] for details.";
    const links = extractWikilinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe("My Note");
    expect(links[0]!.alias).toBeUndefined();
  });

  it("extracts a link with alias [[target|alias]]", () => {
    const content = "Check [[Some Page|click here]] now.";
    const links = extractWikilinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe("Some Page");
    expect(links[0]!.alias).toBe("click here");
  });

  it("skips wikilinks inside code fences", () => {
    const content = [
      "Normal text [[visible]].",
      "```",
      "[[hidden]] inside code fence",
      "```",
      "After fence [[also visible]].",
    ].join("\n");
    const links = extractWikilinks(content);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.target)).toEqual(["visible", "also visible"]);
  });

  it("extracts multiple wikilinks on one line", () => {
    const content = "Link to [[Alpha]] and [[Beta]] and [[Gamma]].";
    const links = extractWikilinks(content);
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.target)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("handles target with path (folder/note)", () => {
    const content = "See [[projects/miranda/overview]] for details.";
    const links = extractWikilinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe("projects/miranda/overview");
  });

  it("reports correct line and column positions", () => {
    const content = "first line\n[[link on line 2]]";
    const links = extractWikilinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]!.position.line).toBe(2);
    expect(links[0]!.position.col).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Tags
// ---------------------------------------------------------------------------

describe("extractTags", () => {
  it("extracts a basic #tag", () => {
    const content = "This is #important content.";
    const tags = extractTags(content);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("important");
  });

  it("extracts multiple tags", () => {
    const content = "#alpha some text #beta more #gamma";
    const tags = extractTags(content);
    expect(tags).toHaveLength(3);
    expect(tags.map((t) => t.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("extracts tags with slashes like #project/miranda", () => {
    const content = "Tagged as #project/miranda/core for tracking.";
    const tags = extractTags(content);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("project/miranda/core");
  });

  it("skips tags inside code fences", () => {
    const content = [
      "#visible tag here",
      "```",
      "#hidden inside code",
      "```",
      "",
      "#also-visible after fence",
    ].join("\n");
    const tags = extractTags(content);
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.name)).toEqual(["visible", "also-visible"]);
  });

  it("does not treat markdown headings as tags", () => {
    const content = "# Heading One\n## Heading Two\nSome #real-tag here.";
    const tags = extractTags(content);
    // The heading regex "# Heading" has a space after #, so "Heading" includes
    // a space which won't match [\w/-]+. Only #real-tag should match.
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("real-tag");
  });

  it("reports correct position for a tag", () => {
    const content = "line one\n#mytag";
    const tags = extractTags(content);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.position.line).toBe(2);
    expect(tags[0]!.position.col).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Headings
// ---------------------------------------------------------------------------

describe("extractHeadings", () => {
  it("extracts h1 through h6 headings", () => {
    const content = ["# H1", "## H2", "### H3", "#### H4", "##### H5", "###### H6"].join("\n");
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(headings[i]!.level).toBe(i + 1);
      expect(headings[i]!.text).toBe(`H${i + 1}`);
    }
  });

  it("returns correct line numbers for multiple headings", () => {
    const content = [
      "# First Heading",
      "",
      "Some paragraph text.",
      "",
      "## Second Heading",
      "",
      "More text here.",
      "",
      "### Third Heading",
    ].join("\n");
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: "First Heading", line: 1 });
    expect(headings[1]).toEqual({ level: 2, text: "Second Heading", line: 5 });
    expect(headings[2]).toEqual({ level: 3, text: "Third Heading", line: 9 });
  });

  it("handles headings with extra whitespace in text", () => {
    const content = "##   Spaced Out Heading  ";
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(1);
    expect(headings[0]!.level).toBe(2);
    expect(headings[0]!.text).toBe("Spaced Out Heading");
  });
});

// ---------------------------------------------------------------------------
// 6. Word count
// ---------------------------------------------------------------------------

describe("word count (via parseVaultMetadata)", () => {
  it("returns 0 for empty content", () => {
    const result = parseVaultMetadata("");
    expect(result.wordCount).toBe(0);
  });

  it("returns 1 for a single word", () => {
    const result = parseVaultMetadata("hello");
    expect(result.wordCount).toBe(1);
  });

  it("counts words in a paragraph correctly", () => {
    const result = parseVaultMetadata("The quick brown fox jumps over the lazy dog.");
    expect(result.wordCount).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 7. Full parseVaultMetadata
// ---------------------------------------------------------------------------

describe("parseVaultMetadata", () => {
  it("extracts all metadata from a combined document", () => {
    const content = [
      "---",
      "title: Integration Test",
      "status: draft",
      "---",
      "# Overview",
      "",
      "This document links to [[Project Alpha|Alpha]] and [[Beta]].",
      "",
      "## Details",
      "",
      "Tagged with #review and #project/miranda.",
    ].join("\n");

    const meta = parseVaultMetadata(content);

    // Frontmatter
    expect(meta.frontmatter).toEqual({ title: "Integration Test", status: "draft" });

    // Headings (line numbers are relative to the body, not the full content)
    expect(meta.headings).toHaveLength(2);
    expect(meta.headings[0]!.text).toBe("Overview");
    expect(meta.headings[0]!.level).toBe(1);
    expect(meta.headings[1]!.text).toBe("Details");
    expect(meta.headings[1]!.level).toBe(2);

    // Links
    expect(meta.links).toHaveLength(2);
    expect(meta.links[0]!.target).toBe("Project Alpha");
    expect(meta.links[0]!.alias).toBe("Alpha");
    expect(meta.links[1]!.target).toBe("Beta");
    expect(meta.links[1]!.alias).toBeUndefined();

    // Tags
    expect(meta.tags).toHaveLength(2);
    expect(meta.tags[0]!.name).toBe("review");
    expect(meta.tags[1]!.name).toBe("project/miranda");

    // Word count (body only, excluding frontmatter)
    expect(meta.wordCount).toBeGreaterThan(0);
  });

  it("handles content with no frontmatter, links, tags, or headings", () => {
    const content = "Just a plain paragraph with no special syntax.";
    const meta = parseVaultMetadata(content);

    expect(meta.frontmatter).toEqual({});
    expect(meta.headings).toEqual([]);
    expect(meta.links).toEqual([]);
    expect(meta.tags).toEqual([]);
    expect(meta.wordCount).toBe(8);
  });
});
