import { describe, expect, it, vi } from "vitest";
import type { VaultService } from "../service.js";
import { syncBrowserClipToVault, type BrowserClip } from "./browser-clip.js";

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

function mockVaultService() {
  return {
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  } as unknown as VaultService & {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncBrowserClipToVault", () => {
  it("creates a new clip note when it does not exist", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue(null);

    await syncBrowserClipToVault(mockClip(), vs);

    expect(vs.create).toHaveBeenCalledTimes(1);
    expect(vs.update).not.toHaveBeenCalled();
  });

  it("updates an existing clip note", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue({ path: "_system/clips/CLIP-2026-02-15-jwt.md" });

    await syncBrowserClipToVault(mockClip(), vs);

    expect(vs.update).toHaveBeenCalledTimes(1);
    expect(vs.create).not.toHaveBeenCalled();
  });

  it("uses date and slugified title in note path", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_system/clips/CLIP-2026-02-15-jwt-authentication-guide.md");
  });

  it("includes title as heading and source URL", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("# JWT Authentication Guide");
    expect(createCall.content).toContain("[docs.oauth2.com](https://docs.oauth2.com/guides/jwt)");
  });

  it("includes frontmatter with type, url, title", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toMatch(/^---\n/);
    expect(createCall.content).toContain("type: clip");
    expect(createCall.content).toContain("url: https://docs.oauth2.com/guides/jwt");
    expect(createCall.content).toContain("title: JWT Authentication Guide");
  });

  it("includes clip content in body", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("JSON Web Tokens (JWT) are an open standard...");
  });

  it("includes session wikilink when sessionId is provided", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip({ sessionId: "sess-abcd-1234-5678-efgh" }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("[[SESSION-sess-abc]]");
  });

  it("includes task wikilink when taskId is provided", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip({ taskId: "task-1234-abcd-5678-efgh" }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("[[TASK-task-123]]");
  });

  it("includes custom tags in frontmatter", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip({ tags: ["oauth", "jwt"] }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("clip");
    expect(createCall.content).toContain("oauth");
    expect(createCall.content).toContain("jwt");
  });

  it("slugifies titles with special characters", async () => {
    const vs = mockVaultService();

    await syncBrowserClipToVault(mockClip({ title: "React 18: What's New & Why It Matters!" }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toMatch(
      /^_system\/clips\/CLIP-2026-02-15-react-18-what-s-new-why-it-matters\.md$/,
    );
  });
});
