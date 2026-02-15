import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../tasks/types.js";
import type { VaultService } from "../service.js";
import { syncTaskToVault } from "./task-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTask(overrides?: Partial<Task>): Task {
  return {
    id: "12345678-abcd-1234-5678-abcdef123456",
    title: "Test Task",
    description: "A test task",
    status: "in_progress",
    priority: "medium",
    type: "instruction",
    source: "user",
    agentId: "default",
    createdAtMs: 1000000,
    updatedAtMs: 2000000,
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

describe("syncTaskToVault", () => {
  // -----------------------------------------------------------------------
  // 1. Creates new note when it doesn't exist
  // -----------------------------------------------------------------------

  it("creates a new note when it does not exist", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue(null);

    await syncTaskToVault(mockTask(), vs);

    expect(vs.create).toHaveBeenCalledTimes(1);
    expect(vs.update).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. Updates existing note
  // -----------------------------------------------------------------------

  it("updates an existing note when it already exists", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue({ path: "_system/tasks/TASK-12345678.md", content: "old" });

    await syncTaskToVault(mockTask(), vs);

    expect(vs.update).toHaveBeenCalledTimes(1);
    expect(vs.create).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Note path uses first 8 chars of ID
  // -----------------------------------------------------------------------

  it("uses the first 8 characters of the task ID in the note path", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(mockTask(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_system/tasks/TASK-12345678.md");
  });

  // -----------------------------------------------------------------------
  // 4. Content includes task title as heading
  // -----------------------------------------------------------------------

  it("includes the task title as a top-level heading", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(mockTask({ title: "Deploy Widget" }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("# Deploy Widget");
  });

  // -----------------------------------------------------------------------
  // 5. Content includes status, priority, type
  // -----------------------------------------------------------------------

  it("includes status, priority, and type in the body", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(
      mockTask({ status: "in_progress", priority: "high", type: "workflow" }),
      vs,
    );

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("**Status:** in progress");
    expect(content).toContain("**Priority:** high");
    expect(content).toContain("**Type:** workflow");
  });

  // -----------------------------------------------------------------------
  // 6. Frontmatter includes taskId, status, priority
  // -----------------------------------------------------------------------

  it("includes taskId, status, and priority in the frontmatter", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(mockTask(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;

    // The content should start with YAML frontmatter
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("taskId: 12345678-abcd-1234-5678-abcdef123456");
    expect(content).toContain("status: in_progress");
    expect(content).toContain("priority: medium");
  });

  // -----------------------------------------------------------------------
  // 7. Handles task with result
  // -----------------------------------------------------------------------

  it("includes result section when task has a result", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(
      mockTask({
        result: { success: true, summary: "Completed successfully" },
      }),
      vs,
    );

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("## Result");
    expect(content).toContain("**Success:** true");
    expect(content).toContain("**Summary:** Completed successfully");
  });

  // -----------------------------------------------------------------------
  // 8. Handles task with progress
  // -----------------------------------------------------------------------

  it("includes progress when task has a progress value", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(mockTask({ progress: 75, progressMessage: "Almost done" }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("**Progress:** 75%");
    expect(content).toContain("**Message:** Almost done");
  });

  // -----------------------------------------------------------------------
  // 9. Frontmatter tags include status and priority
  // -----------------------------------------------------------------------

  it("includes status and priority tags in frontmatter", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(mockTask({ status: "complete", priority: "high" }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("task");
    expect(content).toContain("status/complete");
    expect(content).toContain("priority/high");
  });

  // -----------------------------------------------------------------------
  // 10. Description is included in body
  // -----------------------------------------------------------------------

  it("includes the task description in the body", async () => {
    const vs = mockVaultService();

    await syncTaskToVault(
      mockTask({ description: "This is a detailed description of the task." }),
      vs,
    );

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("This is a detailed description of the task.");
  });
});
