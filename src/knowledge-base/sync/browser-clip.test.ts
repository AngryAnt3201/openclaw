import { describe, expect, it, vi } from "vitest";
import type { KBService } from "../service.js";
import { syncBrowserClipToKB, type BrowserClip } from "./browser-clip.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClip(overrides?: Partial<BrowserClip>): BrowserClip {
  return {
    url: "https://docs.oauth2.com/guides/jwt",
    title: "JWT Authentication Guide",
    content: "JSON Web Tokens (JWT) are an open standard...",
    clippedAtMs: new Date("2026-02-15T10:45:00Z").getTime(),
    ...overrides,
  };
}

function mockKBService() {
  return {
    create: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue(null),
  } as unknown as KBService & {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncBrowserClipToKB", () => {
  it("creates a clip note via upsert", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip(), svc);

    expect(svc.create).toHaveBeenCalledTimes(1);
  });

  it("uses date and slugified title in note path with _miranda prefix", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_miranda/clips/CLIP-2026-02-15-jwt-authentication-guide.md");
  });

  it("includes title as heading and source URL", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("# JWT Authentication Guide");
    expect(createCall.content).toContain("[docs.oauth2.com](https://docs.oauth2.com/guides/jwt)");
  });

  it("includes frontmatter with type, url, title", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toMatch(/^---\n/);
    expect(createCall.content).toContain("type: clip");
    expect(createCall.content).toContain("url: https://docs.oauth2.com/guides/jwt");
    expect(createCall.content).toContain("title: JWT Authentication Guide");
  });

  it("includes clip content in body", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("JSON Web Tokens (JWT) are an open standard...");
  });

  it("includes session wikilink when sessionId is provided", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip({ sessionId: "sess-abcd-1234-5678-efgh" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("[[SESSION-sess-abc]]");
  });

  it("includes task wikilink when taskId is provided", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip({ taskId: "task-1234-abcd-5678-efgh" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("[[TASK-task-123]]");
  });

  it("includes custom tags in frontmatter", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip({ tags: ["oauth", "jwt"] }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("clip");
    expect(createCall.content).toContain("oauth");
    expect(createCall.content).toContain("jwt");
  });

  it("slugifies titles with special characters", async () => {
    const svc = mockKBService();

    await syncBrowserClipToKB(mockClip({ title: "React 18: What's New & Why It Matters!" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toMatch(
      /^_miranda\/clips\/CLIP-2026-02-15-react-18-what-s-new-why-it-matters\.md$/,
    );
  });
});
